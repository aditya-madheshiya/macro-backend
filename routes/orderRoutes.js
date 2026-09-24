const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Order = require('../models/Order'); 
const User = require('../models/User');
const Photo = require('../models/Photo');
const verifyToken = require('../middleware/auth');
const Payout = require('../models/Payout');

// ==========================================
// ⚙️ RAZORPAY INSTANCE INITIALIZATION
// ==========================================
const getRazorpayInstance = () => {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || '',
    key_secret: process.env.RAZORPAY_KEY_SECRET || ''
  });
};

// ==========================================
// 💳 RAZORPAY 1: CREATE PAYMENT ORDER
// ==========================================
router.post('/razorpay-order', verifyToken, async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id;
    const user = await User.findById(rawUserId).populate('cart');

    if (!user || !user.cart || user.cart.length === 0) {
      return res.status(400).json({ success: false, message: "आपकी कार्ट खाली है।" });
    }

    let total = 0;
    user.cart.forEach(photo => {
      const priceStr = photo.price ? String(photo.price) : "0";
      const priceNum = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;
      total += priceNum;
    });

    // Razorpay amount paise me leta hai (₹1 = 100 paise)
    const amountInPaise = Math.round(total * 100);

    if (!amountInPaise || amountInPaise < 100) {
      return res.status(400).json({ success: false, message: "न्यूनतम भुगतान राशि ₹1 (100 पैसे) होनी चाहिए।" });
    }

    const razorpay = getRazorpayInstance();

    const options = {
      amount: amountInPaise,
      currency: "INR",
      receipt: `rcpt_${Date.now()}`
    };

    const rzpOrder = await razorpay.orders.create(options);

    return res.status(200).json({
      success: true,
      orderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID
    });

  } catch (err) {
    console.error("Razorpay Order Creation Error:", err);
    const errText = err?.error?.description || err?.description || err?.message || JSON.stringify(err);
    return res.status(500).json({ success: false, message: "Razorpay ऑर्डर तैयार नहीं हो सका: " + errText });
  }
});

// ==========================================
// 🛡️ RAZORPAY 2: VERIFY SIGNATURE & UNLOCK ASSETS
// ==========================================
router.post('/razorpay-verify', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing verification credentials" });
    }

    // HMAC-SHA256 Signature Verification
    const bodyData = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(bodyData)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "अमान्य हस्ताक्षर! भुगतान सत्यापित नहीं हुआ।" });
    }

    // Verification Success -> Database Update
    const user = await User.findById(userId).populate('cart');
    if (!user) {
      return res.status(404).json({ success: false, message: "यूज़र नहीं मिला।" });
    }

    let total = 0;
    const orderItems = user.cart.map(photo => {
      const priceStr = photo.price ? String(photo.price) : "0";
      const priceNum = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;
      total += priceNum;

      return { 
        photoId: photo._id, 
        price: priceNum // 👈 Cast to Number fix
      };
    });

    const newOrder = new Order({
      user: userId,
      items: orderItems,
      totalAmount: total,
      paymentStatus: 'completed',
      transactionId: razorpay_payment_id
    });
    await newOrder.save();

    if (!user.purchased) {
      user.purchased = [];
    }

    user.cart.forEach(photo => {
      if (photo && photo._id && !user.purchased.some(id => id.toString() === photo._id.toString())) {
        user.purchased.push(photo._id);
      }
    });

    user.cart = [];
    await user.save();

    return res.status(200).json({
      success: true,
      message: "🎉 Payment Verified & Successful! Assets unlocked safely.",
      orderId: newOrder._id
    });

  } catch (err) {
    console.error("Razorpay Verification Error:", err);
    return res.status(500).json({ success: false, message: "Server error during verification: " + err.message });
  }
});

// ==========================================
// 🚀 1. POST: CHECKOUT FLOW (Mock / Local Fallback)
// ==========================================
router.post('/checkout', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
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
        price: priceNum // 👈 Cast to Number fix
      };
    });

    const newOrder = new Order({
      user: userId,
      items: orderItems,
      totalAmount: total,
      paymentStatus: 'completed'
    });
    await newOrder.save();

    if (!user.purchased) {
      user.purchased = [];
    }

    user.cart.forEach(photo => {
      if (photo && photo._id && !user.purchased.some(id => id.toString() === photo._id.toString())) {
        user.purchased.push(photo._id);
      }
    });

    user.cart = [];
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
    const user = await User.findById(req.user.id || req.user._id).populate('purchased');
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
    const photographerId = (req.user.id || req.user._id).toString();
    const completedOrders = await Order.find({ paymentStatus: 'completed' }).populate('items.photoId');

    let totalSoldPhotos = 0;
    let netEarnings = 0;
    let soldPhotosList = [];

    completedOrders.forEach(order => {
      if (order && order.items) {
        order.items.forEach(item => {
          if (item && item.photoId && item.photoId.uploadedBy) {
            const uploaderId = (item.photoId.uploadedBy._id || item.photoId.uploadedBy).toString();
            if (uploaderId === photographerId) {
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

    const user = await User.findByIdAndUpdate(req.user.id || req.user._id, { upiId }, { new: true });
    return res.status(200).json({ success: true, message: "UPI ID सुरक्षित कर ली गई है।", upiId: user.upiId });
  } catch (err) {
    return res.status(500).json({ message: "Error updating UPI ID" });
  }
});

// =========================================================================
// 💸 5. USER: SUBMIT PAYOUT REQUEST (मल्टीपल रिक्वेस्ट + बैलेंस डिडक्शन)
// =========================================================================
router.post('/payout/request', verifyToken, async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id;
    const userId = rawUserId.toString().trim();
    const { amount, upiId } = req.body;
    const reqAmount = parseFloat(amount);

    if (!reqAmount || reqAmount < 100) {
      return res.status(400).json({ 
        success: false, 
        message: 'न्यूनतम विथड्रॉ राशि ₹100 होनी चाहिए।' 
      });
    }

    if (!upiId || !upiId.includes('@')) {
      return res.status(400).json({ 
        success: false, 
        message: 'कृपया एक वैध UPI ID दर्ज करें।' 
      });
    }

    // 1. कुल शुद्ध कमाई (Lifetime Net 80%) निकालें
    const allPhotos = await Photo.find({});
    const myPhotoIds = allPhotos
      .filter(p => p.uploadedBy && (p.uploadedBy._id || p.uploadedBy).toString() === userId)
      .map(p => p._id.toString());

    const orders = await Order.find({ paymentStatus: 'completed' });
    let totalSales = 0;

    orders.forEach(order => {
      const items = order.items && order.items.length > 0 
        ? order.items 
        : (order.photos || []).map(p => ({ photoId: p, price: p?.price || 0 }));

      items.forEach(item => {
        const pId = (item.photoId?._id || item.photoId)?.toString();
        if (myPhotoIds.includes(pId)) {
          const price = parseFloat(String(item.price || 0).replace(/[^0-9.]/g, '')) || 0;
          totalSales += price;
        }
      });
    });

    const netLifetimeEarned = totalSales * 0.80;

    // 2. पेंडिंग और पहले से पेड दोनों पेआउट्स जोड़ें
    const existingPayouts = await Payout.find({ 
      user: userId, 
      status: { $in: ['pending', 'completed'] } 
    });

    const totalCommitted = existingPayouts.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const availableBalance = Math.max(0, netLifetimeEarned - totalCommitted);

    if (reqAmount > availableBalance) {
      return res.status(400).json({ 
        success: false, 
        message: `अपर्याप्त उपलब्ध बैलेंस! आपकी नई उपलब्ध राशि ₹${availableBalance.toFixed(2)} है।` 
      });
    }

    // 🚀 नई विथड्रॉ रिक्वेस्ट दर्ज करें
    const payout = await Payout.create({
      user: userId,
      amount: reqAmount,
      upiId: upiId.trim(),
      status: 'pending'
    });

    return res.status(200).json({ 
      success: true, 
      message: `₹${reqAmount.toFixed(2)} की विथड्रॉ रिक्वेस्ट दर्ज कर दी गई है!`,
      payout 
    });

  } catch (err) {
    console.error("Payout Request Error:", err);
    return res.status(500).json({ success: false, message: 'Server error creating payout request' });
  }
});

// =========================================================================
// 📊 6. USER: GET WALLET STATS (कुल कमाई, पेंडिंग रिक्वेस्ट्स, उपलब्ध बैलेंस)
// =========================================================================
router.get('/payout/my-wallet', verifyToken, async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id;
    const userId = rawUserId.toString().trim();

    const allPhotos = await Photo.find({});
    const myPhotoIds = allPhotos
      .filter(p => p.uploadedBy && (p.uploadedBy._id || p.uploadedBy).toString() === userId)
      .map(p => p._id.toString());

    const orders = await Order.find({ paymentStatus: 'completed' });
    let totalSales = 0;

    orders.forEach(order => {
      const items = order.items && order.items.length > 0 
        ? order.items 
        : (order.photos || []).map(p => ({ photoId: p, price: p?.price || 0 }));

      items.forEach(item => {
        const pId = (item.photoId?._id || item.photoId)?.toString();
        if (myPhotoIds.includes(pId)) {
          const price = parseFloat(String(item.price || 0).replace(/[^0-9.]/g, '')) || 0;
          totalSales += price;
        }
      });
    });

    const netLifetimeEarned = totalSales * 0.80;

    // यूजर के सभी पेआउट्स
    const userPayouts = await Payout.find({ user: userId }).sort({ createdAt: -1 });

    const pendingAmount = userPayouts
      .filter(p => p.status === 'pending')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const paidOutAmount = userPayouts
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const availableBalance = Math.max(0, netLifetimeEarned - (pendingAmount + paidOutAmount));

    return res.status(200).json({
      success: true,
      availableBalance: availableBalance.toFixed(2),
      pendingAmount: pendingAmount.toFixed(2),
      paidOutAmount: paidOutAmount.toFixed(2),
      netLifetimeEarned: netLifetimeEarned.toFixed(2),
      payoutHistory: userPayouts
    });
  } catch (err) {
    console.error("Wallet Fetch Error:", err);
    return res.status(500).json({ success: false, message: 'Error fetching wallet data' });
  }
});

// =========================================================================
// 👑 7. ADMIN: GET VENDOR PAYOUTS MATRIX (पेंडिंग रिक्वेस्ट्स को ट्रैक करना)
// =========================================================================
router.get('/admin-payouts-matrix', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.id || req.user._id;
    const adminUser = await User.findById(adminId);

    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied: Admin only' });
    }

    const completedOrders = await Order.find({ paymentStatus: 'completed' }).populate('items.photoId');
    const vendorMap = new Map();

    for (const order of completedOrders) {
      if (order && order.items) {
        for (const item of order.items) {
          if (item && item.photoId) {
            const photo = item.photoId;
            let photographerIdStr = "";
            if (photo.uploadedBy) {
              photographerIdStr = photo.uploadedBy._id 
                ? photo.uploadedBy._id.toString() 
                : photo.uploadedBy.toString();
            }

            if (!photographerIdStr) continue;

            const priceStr = item.price ? String(item.price) : "0";
            const priceNum = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;

            if (!vendorMap.has(photographerIdStr)) {
              vendorMap.set(photographerIdStr, {
                totalPhotosSold: 0,
                totalSalesAmount: 0
              });
            }

            const v = vendorMap.get(photographerIdStr);
            v.totalPhotosSold += 1;
            v.totalSalesAmount += priceNum;
          }
        }
      }
    }

    const payoutReport = [];

    for (const [vendorId, data] of vendorMap.entries()) {
      const liveUser = await User.findById(vendorId).select('firstName lastName email upiId');
      
      const finalName = liveUser 
        ? `${liveUser.firstName || ''} ${liveUser.lastName || ''}`.trim() || "Active Creator"
        : `Deleted Account (ID: ..${vendorId.slice(-4)})`;
      
      const finalEmail = liveUser?.email || 'N/A';
      
      const pendingReqs = await Payout.find({ user: vendorId, status: 'pending' });
      const pendingTotal = pendingReqs.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const paidPayouts = await Payout.find({ user: vendorId, status: 'completed' });
      const totalPaid = paidPayouts.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const netLifetimeEarned = data.totalSalesAmount * 0.80;
      const netPayableBalance = Math.max(0, netLifetimeEarned - totalPaid);

      payoutReport.push({
        photographerId: vendorId,
        photographerName: finalName,
        photographerEmail: finalEmail,
        upiId: pendingReqs[0]?.upiId || liveUser?.upiId || 'Not Provided',
        totalPhotosSold: data.totalPhotosSold,
        totalSalesAmount: data.totalSalesAmount,
        amountToPay: pendingTotal > 0 ? pendingTotal : netPayableBalance,
        hasPendingRequest: pendingTotal > 0,
        pendingCount: pendingReqs.length
      });
    }

    return res.status(200).json({ success: true, payoutReport });

  } catch (err) {
    console.error("Admin Payout Matrix Error:", err);
    return res.status(500).json({ message: "Error generating admin payout report" });
  }
});

// =========================================================================
// 👑 8. ADMIN: SETTLE VENDOR (पैसे भेजकर पेंडिंग को 0 करना)
// =========================================================================
router.post('/admin-settle-vendor', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.id || req.user._id;
    const adminUser = await User.findById(adminId);

    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied: Admin only' });
    }

    const { vendorId, amount, upiId, transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({ success: false, message: 'कृपया बैंक/UPI का UTR नंबर दर्ज करें।' });
    }

    const pendingReqs = await Payout.find({ user: vendorId, status: 'pending' });

    if (pendingReqs.length > 0) {
      for (const reqItem of pendingReqs) {
        reqItem.status = 'completed';
        reqItem.transactionId = transactionId;
        await reqItem.save();
      }
    } else {
      await Payout.create({
        user: vendorId,
        amount: Number(amount),
        upiId: upiId,
        status: 'completed',
        transactionId: transactionId
      });
    }

    return res.status(200).json({
      success: true,
      message: `₹${Number(amount).toFixed(2)} का भुगतान UTR (${transactionId}) के साथ सफलतापूर्वक सेटल हो गया!`
    });

  } catch (err) {
    console.error("Settle Vendor Error:", err);
    return res.status(500).json({ success: false, message: 'Server error settling payout' });
  }
});

module.exports = router;