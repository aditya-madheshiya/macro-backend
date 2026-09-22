const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Photo = require('../models/Photo');
const User = require('../models/User');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

// 🔒 टोकन वेरिफिकेशन मिडलवेयर (इन-लाइन)
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // इसमें लॉगिन यूजर की id and role मिल जाएगी
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// =========================================================================
// 📊 GET DASHBOARD SUMMARY (🎯 महा फिक्स: एडमिन के लिए टोटल प्लेटफॉर्म रेवेन्यू)
// =========================================================================
router.get('/dashboard-summary', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const liveLikedCount = user.likedPhotos ? user.likedPhotos.length : 0;
    const livePurchasedCount = user.purchased ? user.purchased.length : 0;
    const Order = mongoose.model('Order'); 

    let liveTotalSpent = 0;

    // 🎯 चेक करें कि क्या लॉगिन करने वाला यूजर एडमिन है
    if (user.role === 'admin') {
      // 👑 एडमिन के लिए: डेटाबेस के सभी यूज़र्स के सभी सफल ऑर्डर्स को खोजें और जोड़ें
      const allCompletedOrders = await Order.find({ paymentStatus: 'completed' });
      allCompletedOrders.forEach(order => {
        liveTotalSpent += order.totalAmount || 0;
      });
    } else {
      // 👤 नॉर्मल यूजर के लिए: सिर्फ उसका खुद का कुल खर्च जोड़ें
      const userOrders = await Order.find({ user: userId, paymentStatus: 'completed' });
      userOrders.forEach(order => {
        liveTotalSpent += order.totalAmount || 0;
      });
    }

    return res.status(200).json({
      userName: `${user.firstName} ${user.lastName || ''}`,
      purchasedCount: livePurchasedCount,       
      downloadsCount: livePurchasedCount,       
      likedCount: liveLikedCount,               
      totalSpent: liveTotalSpent.toFixed(2) // 🎯 एडमिन के लिए यह कुल प्लेटफॉर्म सेल बन जाएगा
    });

  } catch (err) {
    console.error("Dashboard Summary Error:", err);
    return res.status(500).json({ message: 'Server error fetching summary' });
  }
});

// ===================================================
// 🎯 LIVE USER PROFILE ENDPOINT (UPI ID सपोर्ट के साथ)
// ===================================================
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      firstName: user.firstName,
      lastName: user.lastName || '',
      email: user.email,
      role: user.role,
      upiId: user.upiId || '', 
      createdAt: user.createdAt
    });
  } catch (err) {
    console.error("Profile Fetch Error:", err);
    return res.status(500).json({ message: 'Server error while fetching profile' });
  }
});

// ===================================================
// 🎯 1. GET USER WISHLIST PHOTOS
// ===================================================
router.get('/wishlist', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('likedPhotos');
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const wishlistItems = user.likedPhotos || [];
    return res.status(200).json(wishlistItems);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error fetching wishlist' });
  }
});

// ===================================================
// 🗑️ 2. REMOVE PHOTO FROM WISHLIST
// ===================================================
router.delete('/wishlist/:photoId', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.likedPhotos = user.likedPhotos.filter(id => id.toString() !== req.params.photoId);
    await user.save();

    return res.status(200).json({ success: true, message: 'Removed from wishlist' });
  } catch (err) {
    return res.status(500).json({ message: 'Server error removing item' });
  }
});

// ===================================================
// 🎯 ADD PHOTO TO WISHLIST (डुप्लीकेट रोकेगा)
// ===================================================
router.post('/wishlist/add', verifyToken, async (req, res) => {
  try {
    const { photoId } = req.body;
    const user = await User.findById(req.user.id || req.user._id);
    
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.likedPhotos) user.likedPhotos = [];

    if (user.likedPhotos.includes(photoId.toString())) {
      return res.status(200).json({ success: true, message: 'Already in wishlist matrix' });
    }

    user.likedPhotos.push(photoId);
    await user.save();

    return res.status(200).json({ success: true, message: 'Added to wishlist!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ===================================================
// 🗑️ DELETE PHOTO ENDPOINT (डेटाबेस और Cloudinary दोनों से साफ़ करेगा)
// ===================================================
router.delete('/photos/:photoId', verifyToken, async (req, res) => {
  try {
    const { photoId } = req.params;
    const userId = req.user.id || req.user._id;

    const requestingUser = await User.findById(userId);
    const userRole = requestingUser ? requestingUser.role : 'user';

    const photo = await Photo.findById(photoId);
    if (!photo) {
      return res.status(404).json({ message: 'Photo asset not found' });
    }

    if (photo.uploadedBy.toString() !== userId.toString() && userRole !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized deletion attempt' });
    }

    if (photo.imageUrl) {
      try {
        const urlParts = photo.imageUrl.split('/');
        const folderName = urlParts[urlParts.length - 2]; 
        const fileNameWithExt = urlParts[urlParts.length - 1]; 
        const publicId = `${folderName}/${fileNameWithExt.split('.')[0]}`; 

        console.log("Cloudinary से इस ID को डिलीट कर रहे हैं:", publicId);
        await cloudinary.uploader.destroy(publicId);
      } catch (cloudinaryErr) {
        console.error("Cloudinary से डिलीट करने में दिक्कत आई, पर DB से हटा रहे हैं:", cloudinaryErr);
      }
    }

    await Photo.findByIdAndDelete(photoId);
    return res.status(200).json({ success: true, message: 'Asset purged from website and Cloudinary!' });
  } catch (err) {
    console.error("Purge Error:", err);
    return res.status(500).json({ message: 'Server error during deletion' });
  }
});

// =========================================================================
// 📊 GET CREATOR'S OWN UPLOADED PHOTOS (एडमिन को 100% फोटो मिलेंगी)
// =========================================================================
router.get('/my-uploads', verifyToken, async (req, res) => {
  try {
    const rawId = req.user.id || req.user._id;
    if (!rawId) {
      return res.status(401).json({ message: 'User identity could not be verified' });
    }

    const userId = rawId.toString().trim(); 

    const checkUser = await User.findById(userId);
    const userRole = checkUser ? checkUser.role : 'user'; 

    const allPhotos = await Photo.find({});

    if (userRole === 'admin') {
      return res.status(200).json(allPhotos);
    }

    const userSpecificPhotos = allPhotos.filter(photo => {
      if (!photo.uploadedBy) return false;
      return photo.uploadedBy.toString().trim() === userId;
    });

    return res.status(200).json(userSpecificPhotos);

  } catch (err) {
    console.error("My Studio Specific Fetch Error:", err);
    return res.status(500).json({ message: 'Server error filtering your portfolio' });
  }
});

// ===================================================
// 🛒 1. ADD PHOTO TO CART (WITH SECURITY CHECK)
// ===================================================
router.post('/cart/add', verifyToken, async (req, res) => {
  try {
    const { photoId } = req.body;
    const userId = req.user.id || req.user._id;

    const photo = await Photo.findById(photoId);
    if (!photo) {
      return res.status(404).json({ message: 'तस्वीर मार्केटप्लेस में नहीं मिली।' });
    }

    if (photo.uploadedBy && photo.uploadedBy.toString() === userId.toString()) {
      return res.status(400).json({ 
        success: false, 
        message: '🚨 Security Alert: आप अपनी खुद की अपलोड की हुई तस्वीर नहीं खरीद सकते!' 
      });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.cart) user.cart = [];

    if (user.cart.includes(photoId.toString())) {
      return res.status(400).json({ message: 'यह एसेट पहले से ही आपकी CART में है!' });
    }

    user.cart.push(photoId);
    await user.save();

    return res.status(200).json({ success: true, message: 'Added to cart successfully!' });
  } catch (err) {
    console.error("Cart Add Error:", err);
    return res.status(500).json({ message: 'Server error adding to cart' });
  }
});

// ===================================================
// 📊 2. GET LIVE CART ITEMS
// ===================================================
router.get('/cart', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id || req.user._id).populate('cart');
    if (!user) return res.status(404).json({ message: 'User not found' });

    return res.status(200).json(user.cart || []);
  } catch (err) {
    return res.status(500).json({ message: 'Error fetching cart' });
  }
});

// ===================================================
// 🗑️ 3. REMOVE PHOTO FROM CART
// ===================================================
router.delete('/cart/:photoId', verifyToken, async (req, res) => {
  try {
    const { photoId } = req.params;
    const user = await User.findById(req.user.id || req.user._id);

    if (!user) return res.status(404).json({ message: 'User not found' });

    user.cart = user.cart.filter(id => id.toString() !== photoId.toString());
    await user.save();

    return res.status(200).json({ success: true, message: 'Removed from cart' });
  } catch (err) {
    return res.status(500).json({ message: 'Error removing from cart' });
  }
});

module.exports = router;