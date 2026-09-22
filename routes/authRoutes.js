const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// 📝 1. PUBLIC SIGNUP ENDPOINT  
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    // चेक करें कि यूज़र पहले से मौजूद तो नहीं है
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: 'User already exists' });

    // सुरक्षा के लिए पासवर्ड हैश करना
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // प्रोडक्शन रूल: नया साइनअप हमेशा डिफ़ॉल्ट 'user' रोल में ही सेव होगा
    user = new User({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role: 'user' // डेटाबेस मॉडल में यह वैल्यू जाएगी
    });

    await user.save();
    
    // 🎯 फिक्स: स्टेटस 201 के साथ साफ़ रिस्पॉन्स भेजना
    return res.status(201).json({ 
      success: true,
      message: 'Account created successfully!' 
    });
  } catch (err) {
    return res.status(500).json({ message: 'Server error during registration' });
  }
});

// 🔑 2. AUTHENTICATED LOGIN ENDPOINT
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // डेटाबेस से यूज़र और उसका रोल चेक करना
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid Credentials' });

    // पासवर्ड वेरीफाई करना
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid Credentials' });

    // सिक्योर JWT टोकन जनरेट करना (इसमें रोल भी शामिल रहेगा)
    const token = jwt.sign(
      { id: user._id, role: user.role }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' }
    );

    // 🎯 फिक्स: स्टेटस 200 (OK) को एक्सप्रेस में एक्सप्लिसिटली (Explicitly) सेट करना ताकि फ्रंटएंड को रिस्पॉन्स मिलने में कोई एरर न आए
    return res.status(200).json({ 
      token: token, 
      role: user.role, // ⚡ यह आपके MongoDB Compass से लाइव 'admin' या 'user' उठाएगा
      user: { 
        id: user._id, 
        firstName: user.firstName, 
        email: user.email 
      } 
    });
  } catch (err) {
    return res.status(500).json({ message: 'Server error during authentication' });
  }
});

module.exports = router;