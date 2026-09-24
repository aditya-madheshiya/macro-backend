const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Photo = require('../models/Photo');
const User = require('../models/User');
const Order = require('../models/Order');
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
// 📊 GET DASHBOARD SUMMARY (एडमिन + यूजर रेवेन्यू + डेटा रिकवरी)
// =========================================================================
router.get('/dashboard-summary', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId)
      .populate('purchased')
      .populate('purchasedPhotos');

    if (!user) return res.status(404).json({ message: 'User not found' });

    const liveLikedCount = user.likedPhotos ? user.likedPhotos.length : 0;

    // 🎯 दोनों एरे को सुरक्षित तरीके से मर्ज करें ताकि पुराने और नए दोनों एसेट्स आएँ
    const rawPurchased = [
      ...(user.purchased || []),
      ...(user.purchasedPhotos || [])
    ];

    const uniqueMap = new Map();
    rawPurchased.forEach(item => {
      if (!item) return;
      const id = (item._id || item).toString();
      if (!uniqueMap.has(id)) {
        uniqueMap.set(id, item);
      }
    });

    const uniquePurchasedList = Array.from(uniqueMap.values());
    const livePurchasedCount = uniquePurchasedList.length;

    let liveTotalSpent = 0;

    if (user.role === 'admin') {
      // 👑 एडमिन के लिए: सभी सफल ऑर्डर्स को जोड़ें
      const allCompletedOrders = await Order.find({ paymentStatus: 'completed' });
      if (allCompletedOrders.length > 0) {
        allCompletedOrders.forEach(order => {
          liveTotalSpent += Number(order.totalAmount) || 0;
        });
      } else {
        // फॉलबैक: अगर पुराने ऑर्डर्स डेटाबेस में नहीं बने थे, तो खरीदे गए एसेट्स से जोड़ें
        const allUsers = await User.find({}).populate('purchased').populate('purchasedPhotos');
        allUsers.forEach(u => {
          const userItems = [...(u.purchased || []), ...(u.purchasedPhotos || [])];
          userItems.forEach(p => {
            if (p && p.price) {
              const num = parseFloat(String(p.price).replace(/[^0-9.]/g, '')) || 0;
              liveTotalSpent += num;
            }
          });
        });
      }
    } else {
      // 👤 नॉर्मल यूजर के लिए: उसके खुद के सफल ऑर्डर्स जोड़ें
      const userOrders = await Order.find({ user: userId, paymentStatus: 'completed' });
      if (userOrders.length > 0) {
        userOrders.forEach(order => {
          liveTotalSpent += Number(order.totalAmount) || 0;
        });
      } else {
        // फॉलबैक: अगर Order रिकॉर्ड नहीं बना था, तो फ़ोटो प्राइस से जोड़ें
        uniquePurchasedList.forEach(p => {
          if (p && p.price) {
            const num = parseFloat(String(p.price).replace(/[^0-9.]/g, '')) || 0;
            liveTotalSpent += num;
          }
        });
      }
    }

    return res.status(200).json({
      userName: `${user.firstName} ${user.lastName || ''}`.trim(),
      purchasedCount: livePurchasedCount,       
      downloadsCount: livePurchasedCount,       
      likedCount: liveLikedCount,               
      totalSpent: liveTotalSpent.toFixed(2)
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
    const user = await User.findById(req.user.id || req.user._id).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // 🎯 दोनों एरे को कंबाइन करके यूनिक IDs तैयार करें
    const allPurchased = [
      ...(user.purchased || []),
      ...(user.purchasedPhotos || [])
    ].map(id => (id?._id || id).toString());

    const uniquePurchasedIds = [...new Set(allPurchased)];

    return res.status(200).json({
      firstName: user.firstName,
      lastName: user.lastName || '',
      email: user.email,
      role: user.role,
      upiId: user.upiId || '', 
      purchasedPhotos: uniquePurchasedIds,
      createdAt: user.createdAt
    });
  } catch (err) {
    console.error("Profile Fetch Error:", err);
    return res.status(500).json({ message: 'Server error while fetching profile' });
  }
});

// ===================================================
// 📦 GET USER PURCHASED PHOTOS
// ===================================================
router.get('/purchased-photos', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id || req.user._id)
      .populate('purchasedPhotos')
      .populate('purchased');

    if (!user) return res.status(404).json({ message: 'User not found' });

    const all = [...(user.purchasedPhotos || []), ...(user.purchased || [])];
    const uniqueMap = new Map();
    all.forEach(item => {
      if (!item) return;
      const id = (item._id || item).toString();
      if (!uniqueMap.has(id)) {
        uniqueMap.set(id, item);
      }
    });

    return res.status(200).json(Array.from(uniqueMap.values()));
  } catch (err) {
    console.error("Purchased Photos Fetch Error:", err);
    return res.status(500).json({ message: 'Error fetching purchased items' });
  }
});

// ===================================================
// 🎯 1. GET USER WISHLIST PHOTOS
// ===================================================
router.get('/wishlist', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id || req.user._id).populate('likedPhotos');
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
    const user = await User.findById(req.user.id || req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.likedPhotos = (user.likedPhotos || []).filter(id => id.toString() !== req.params.photoId);
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

    if (user.likedPhotos.some(id => id.toString() === photoId.toString())) {
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

    if (photo.uploadedBy && photo.uploadedBy.toString() !== userId.toString() && userRole !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized deletion attempt' });
    }

    if (photo.imageUrl) {
      try {
        const urlParts = photo.imageUrl.split('/');
        const folderName = urlParts[urlParts.length - 2]; 
        const fileNameWithExt = urlParts[urlParts.length - 1]; 
        const publicId = `${folderName}/${fileNameWithExt.split('.')[0]}`; 

        await cloudinary.uploader.destroy(publicId);
      } catch (cloudinaryErr) {
        console.error("Cloudinary error, continuing DB removal:", cloudinaryErr);
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
// 🛒 1. ADD PHOTO TO CART (SECURITY + ALREADY PURCHASED CHECK)
// ===================================================
router.post('/cart/add', verifyToken, async (req, res) => {
  try {
    const { photoId } = req.body;
    const userId = req.user.id || req.user._id;

    const photo = await Photo.findById(photoId);
    if (!photo) {
      return res.status(404).json({ message: 'तस्वीर मार्केटप्लेस में नहीं मिली।' });
    }

    // 🛑 1. खुद की फोटो खरीदने से रोकें
    if (photo.uploadedBy && photo.uploadedBy.toString() === userId.toString()) {
      return res.status(400).json({ 
        success: false, 
        message: '🚨 Security Alert: आप अपनी खुद की अपलोड की हुई तस्वीर नहीं खरीद सकते!' 
      });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // 🛑 2. पहले से खरीदी हुई दोनों फ़ील्ड्स में चेक करें
    const allPurchased = [
      ...(user.purchased || []),
      ...(user.purchasedPhotos || [])
    ].map(id => (id?._id || id).toString());

    if (allPurchased.includes(photoId.toString())) {
      return res.status(400).json({
        success: false,
        message: '⚠️ यह एसेट आप पहले ही खरीद चुके हैं! यह आपके डैशबोर्ड में अनलॉक है।'
      });
    }

    if (!user.cart) user.cart = [];

    // 🛑 3. कार्ट में डुप्लीकेट रोकें
    if (user.cart.some(id => id.toString() === photoId.toString())) {
      return res.status(400).json({ 
        success: false, 
        message: 'यह एसेट पहले से ही आपकी CART में है!' 
      });
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
// 📊 2. GET LIVE CART ITEMS (AUTO REMOVES ALREADY PURCHASED)
// ===================================================
router.get('/cart', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id || req.user._id).populate('cart');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const allPurchased = [
      ...(user.purchased || []),
      ...(user.purchasedPhotos || [])
    ].map(id => (id?._id || id).toString());
    
    // अगर कोई खरीदा हुआ आइटम अभी भी कार्ट में अटका हो, तो उसे फ़िल्टर करें
    const validCartItems = (user.cart || []).filter(item => {
      if (!item) return false;
      const itemId = (item._id || item).toString();
      return !allPurchased.includes(itemId);
    });

    return res.status(200).json(validCartItems);
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

    user.cart = (user.cart || []).filter(id => id.toString() !== photoId.toString());
    await user.save();

    return res.status(200).json({ success: true, message: 'Removed from cart' });
  } catch (err) {
    return res.status(500).json({ message: 'Error removing from cart' });
  }
});

// ===================================================
// 📜 GET USER'S ORDER HISTORY
// ===================================================
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const orders = await Order.find({ user: userId })
      .populate('photos')
      .populate('items.photoId')
      .sort({ createdAt: -1 });

    return res.status(200).json(orders);
  } catch (err) {
    console.error("Fetch Orders Error:", err);
    return res.status(500).json({ message: 'Error fetching order history' });
  }
});

// =========================================================================
// 📈 GET CREATOR / ADMIN OWN SALES LOG (100% Guaranteed Data Sync & Fallback)
// =========================================================================
router.get('/creator-sales', verifyToken, async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id;
    const userIdStr = rawUserId.toString().trim();

    // 1. इस यूजर की अपलोड की हुई तस्वीरें निकालें (String और ObjectId दोनों मैचिंग)
    const allPhotos = await Photo.find({});
    const myPhotos = allPhotos.filter(p => {
      if (!p.uploadedBy) return false;
      const creatorId = (p.uploadedBy._id || p.uploadedBy).toString().trim();
      return creatorId === userIdStr;
    });

    const myPhotoIds = myPhotos.map(p => p._id.toString());

    if (myPhotoIds.length === 0) {
      return res.status(200).json({
        totalEarned: "0.00",
        soldItemsCount: 0,
        salesLog: []
      });
    }

    const salesLog = [];
    let myTotalEarned = 0;

    // 2. ऑर्डर्स कलेक्शन से चेक करें
    const orders = await Order.find({ paymentStatus: 'completed' })
      .populate('user', 'firstName lastName email')
      .populate('photos')
      .populate('items.photoId')
      .sort({ createdAt: -1 });

    if (orders.length > 0) {
      orders.forEach(order => {
        // Items array चेक करें
        if (order.items && order.items.length > 0) {
          order.items.forEach(item => {
            const photoObj = item.photoId;
            const pId = (photoObj?._id || photoObj)?.toString();

            if (myPhotoIds.includes(pId)) {
              const price = Number(item.price) || 0;
              myTotalEarned += price;
              salesLog.push({
                orderId: order._id,
                photoTitle: photoObj?.title || "Macro Asset",
                photoUrl: photoObj?.imageUrl,
                buyerName: `${order.user?.firstName || 'Buyer'} ${order.user?.lastName || ''}`.trim(),
                buyerEmail: order.user?.email || 'N/A',
                amount: price,
                date: order.createdAt
              });
            }
          });
        }

        // Direct photos array चेक करें (अगर items में डेटा न हो)
        if (order.photos && order.photos.length > 0) {
          order.photos.forEach(photoObj => {
            const pId = (photoObj?._id || photoObj)?.toString();
            const alreadyAdded = salesLog.some(
              s => s.orderId.toString() === order._id.toString() && s.photoTitle === photoObj.title
            );

            if (myPhotoIds.includes(pId) && !alreadyAdded) {
              const price = parseFloat(String(photoObj?.price || '0').replace(/[^0-9.]/g, '')) || 0;
              myTotalEarned += price;
              salesLog.push({
                orderId: order._id,
                photoTitle: photoObj?.title || "Macro Asset",
                photoUrl: photoObj?.imageUrl,
                buyerName: `${order.user?.firstName || 'Buyer'} ${order.user?.lastName || ''}`.trim(),
                buyerEmail: order.user?.email || 'N/A',
                amount: price,
                date: order.createdAt
              });
            }
          });
        }
      });
    }

    // 3. 🎯 फॉलबैक: अगर पुराने ऑर्डर्स डेटाबेस में नहीं बने थे, तो Users के Purchased Arrays से निकालें
    if (salesLog.length === 0) {
      const allBuyers = await User.find({}).populate('purchased').populate('purchasedPhotos');

      allBuyers.forEach(buyer => {
        // खुद की खरीद को इग्नोर करें
        if (buyer._id.toString() === userIdStr) return;

        const buyerPurchases = [...(buyer.purchased || []), ...(buyer.purchasedPhotos || [])];
        const uniqueBuyerMap = new Map();

        buyerPurchases.forEach(item => {
          if (item && item._id) {
            uniqueBuyerMap.set(item._id.toString(), item);
          }
        });

        uniqueBuyerMap.forEach((photoObj, pId) => {
          if (myPhotoIds.includes(pId)) {
            const price = parseFloat(String(photoObj?.price || '0').replace(/[^0-9.]/g, '')) || 0;
            myTotalEarned += price;
            salesLog.push({
              orderId: "LEGACY-" + pId.slice(-6).toUpperCase(),
              photoTitle: photoObj.title || "Macro Asset",
              photoUrl: photoObj.imageUrl,
              buyerName: `${buyer.firstName} ${buyer.lastName || ''}`.trim(),
              buyerEmail: buyer.email,
              amount: price,
              date: buyer.updatedAt || new Date()
            });
          }
        });
      });
    }

    return res.status(200).json({
      totalEarned: myTotalEarned.toFixed(2),
      soldItemsCount: salesLog.length,
      salesLog
    });

  } catch (err) {
    console.error("Creator Sales Ledger Error:", err);
    return res.status(500).json({ message: "Error loading creator sales log" });
  }
});

module.exports = router;