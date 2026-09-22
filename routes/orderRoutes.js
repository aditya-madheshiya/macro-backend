const express = require('express');
const router = express.Router();
const Order = require('../models/Order'); 
const User = require('../models/User');
const Photo = require('../models/Photo'); // फोटो मॉडल भी इम्पोर्ट कर लिया
const verifyToken = require('../middleware/auth'); // आपका auth.js मिडलवेयर

// ==========================================
// 🚀 1. POST: CHECKOUT FLOW (Mock Payment)
// ==========================================
router.post('/checkout', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).populate('cart');

    if (!user || !user.cart || user.cart.length === 0) {
      return res.status(400).json({ message: "आपकी कार्ट खाली है या यूज़र नहीं मिला।" });
    }

    let total = 0;
    const orderItems = user.cart.map(photo => {
      const priceStr = photo.price ? String(photo.price) : "0";
      const priceNum = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;
      total += priceNum;
      
      return { 
        photoId: photo._id, 
        price: photo.price || "0" 
      };
    });

    // डेटाबेस में एक कम्प्लीटेड ऑर्डर बनाएं
    const newOrder = new Order({
      user: userId,
      items: orderItems,
      totalAmount: total,
      paymentStatus: 'completed'
    });
    await newOrder.save();

    // ⚡ सेफ ट्रांसफर: purchased एरे में डालें
    if (!user.purchased) {
      user.purchased = [];
    }

    user.cart.forEach(photo => {
      if (photo && photo._id && !user.purchased.some(id => id.toString() === photo._id.toString())) {
        user.purchased.push(photo._id);
      }
    });

    user.cart = []; // कार्ट खाली करें
    await user.save();

    return res.status(200).json({
      success: true,
      message: "🎉 Payment Successful! Assets unlocked safely.",
      orderId: newOrder._id
    });

  } catch (err) {
    console.error("Checkout Server Critical Error:", err);
    return res.status(500).json({ message: "Internal Server Error: " + err.message });
  }
});

// ==========================================
// 🖼️ 2. GET: FETCH PURCHASED ASSETS FOR USER
// ==========================================
router.get('/purchased-assets', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('purchased');
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(200).json(user.purchased || []);
  } catch (err) {
    return res.status(500).json({ message: "Error fetching purchased nodes" });
  }
});

// ==========================================
// 💰 3. GET: PHOTOGRAPHER DASHBOARD EARNINGS
// ==========================================
router.get('/photographer-dashboard', verifyToken, async (req, res) => {
  try {
    const photographerId = req.user.id;
    
    // केवल वही ऑर्डर्स ढूंढें जो कम्प्लीट हैं
    const completedOrders = await Order.find({ paymentStatus: 'completed' }).populate('items.photoId');

    let totalSoldPhotos = 0;
    let netEarnings = 0;
    let soldPhotosList = [];

    completedOrders.forEach(order => {
      if (order && order.items) {
        order.items.forEach(item => {
          if (item && item.photoId && item.photoId.uploadedBy && item.photoId.uploadedBy.toString() === photographerId) {
            totalSoldPhotos += 1; 
            
            const priceStr = item.price ? String(item.price) : "0";
            const priceNum = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;
            netEarnings += (priceNum * 0.80); 

            soldPhotosList.push({
              title: item.photoId.title || "Deleted Asset",
              imageUrl: item.photoId.imageUrl || "",
              originalPrice: item.price || "0",
              yourEarnings: `₹${(priceNum * 0.80).toFixed(2)}`,
              soldAt: order.createdAt
            });
          }
        });
      }
    });

    return res.status(200).json({
      success: true,
      totalSoldPhotos,
      netEarnings: `₹${netEarnings.toFixed(2)}`,
      soldPhotosList
    });
  } catch (err) {
    console.error("Photographer Dashboard Error:", err);
    return res.status(500).json({ message: "Error loading photographer dashboard data" });
  }
});

// ==========================================
// 💳 4. PUT: UPDATE UPI ID FOR PAYOUTS
// ==========================================
router.put('/update-upi', verifyToken, async (req, res) => {
  try {
    const { upiId } = req.body;
    if (!upiId) return res.status(400).json({ message: "UPI ID ज़रूरी है।" });

    const user = await User.findByIdAndUpdate(req.user.id, { upiId }, { new: true });
    return res.status(200).json({ success: true, message: "UPI ID सुरक्षित कर ली गई है।", upiId: user.upiId });
  } catch (err) {
    return res.status(500).json({ message: "Error updating UPI ID" });
  }
});

// =========================================================================
// 👑 5. GET: ADMIN PAYOUT MATRIX (🎯 महा फिक्स: 100% लाइव यूजर नेम शो करने का लॉजिक)
// =========================================================================
router.get('/admin-payouts-matrix', verifyToken, async (req, res) => {
  try {
    // 1. सभी कम्प्लीटेड ऑर्डर्स को डेटाबेस से निकालें
    const completedOrders = await Order.find({ paymentStatus: 'completed' }).populate('items.photoId');

    let payoutReport = {};

    // 2. ऑर्डर्स पर लूप चलाकर डेटा प्रोसेस करें
    for (const order of completedOrders) {
      if (order && order.items) {
        for (const item of order.items) {
          
          // अगर ऑर्डर आइटम और फोटो एसेट मौजूद है
          if (item && item.photoId) {
            const photo = item.photoId;
            
            // वेंडर आईडी निकालें (चाहे ऑब्जेक्ट हो या डायरेक्ट आईडी स्ट्रिंग हो)
            let photographerIdStr = "";
            if (photo.uploadedBy) {
              photographerIdStr = photo.uploadedBy._id 
                ? photo.uploadedBy._id.toString() 
                : photo.uploadedBy.toString();
            }

            if (!photographerIdStr) continue; // अगर कोई आईडी नहीं है तो स्किप करें

            // डिफ़ॉल्ट बैकअप वैल्यूज
            let finalName = "Photographer Node";
            let finalEmail = "vendor@macroverse.com";
            let finalUpi = "Not Provided";

            // 🎯 महा फिक्स: डेटाबेस से सीधे लाइव यूजर को ढूंढें ताकि पॉप्युलेट का कोई भी बग नाम न छुपा सके
            const liveUser = await User.findById(photographerIdStr).select('firstName lastName email upiId');
            
            if (liveUser) {
              finalName = `${liveUser.firstName || ''} ${liveUser.lastName || ''}`.trim() || "Active Creator";
              finalEmail = liveUser.email || 'N/A';
              finalUpi = liveUser.upiId || 'Not Provided';
            } else {
              // अगर यूजर सच में डिलीट हो गया है तभी ये दिखेगा
              finalName = `Deleted Account (ID: ..${photographerIdStr.slice(-4)})`;
            }

            const priceStr = item.price ? String(item.price) : "0";
            const priceNum = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;

            // रिपोर्ट ऑब्जेक्ट में डेटा पुश करें
            if (!payoutReport[photographerIdStr]) {
              payoutReport[photographerIdStr] = {
                photographerName: finalName,
                photographerEmail: finalEmail,
                upiId: finalUpi,
                totalPhotosSold: 0,
                totalSalesAmount: 0,
                amountToPay: 0 
              };
            }

            payoutReport[photographerIdStr].totalPhotosSold += 1;
            payoutReport[photographerIdStr].totalSalesAmount += priceNum;
            payoutReport[photographerIdStr].amountToPay += (priceNum * 0.80);
          }
        }
      }
    }

    const finalReport = Object.values(payoutReport);
    return res.status(200).json({ success: true, payoutReport: finalReport });
    
  } catch (err) {
    console.error("Admin Payout Matrix Error:", err);
    return res.status(500).json({ message: "Error generating admin payout report" });
  }
});

module.exports = router;