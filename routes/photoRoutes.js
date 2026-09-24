const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const Photo = require('../models/Photo');

// 🔒 टोकन वेरिफिकेशन मिडलवेयर इम्पोर्ट करें
const verifyToken = require('../middleware/auth'); 

// ⚙️ 1. Cloudinary कॉन्फ़िगरेशन
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ⚙️ 2. सिम्पल मेमोरी स्टोरेज सेटअप
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// 🚀 3. PHOTO UPLOAD ENDPOINT
router.post('/upload', verifyToken, upload.single('image'), async (req, res) => {
  try {
    const { title, category, price, magnification } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'कृपया एक माइक्रो फ़ोटो अपलोड करें' });
    }

    // ⚡ क्लाउडिनरी पर डायरेक्ट बफर अपलोड (Stream Upload)
    const uploadToCloudinary = (fileBuffer) => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder: 'macroverse_photos' },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        uploadStream.end(fileBuffer);
      });
    };

    // अपलोड चलाएं
    const cloudinaryResult = await uploadToCloudinary(req.file.buffer);

    // 🎯 टोकन से लॉगिन यूजर की असली आईडी निकालना
    const rawId = req.user.id || req.user._id;
    if (!rawId) {
      return res.status(401).json({ message: 'User identity missing in token' });
    }

    // डेटाबेस में सेव करें
    const newPhoto = new Photo({
      title,
      category,
      price,
      magnification: magnification || "Macro Shot",
      imageUrl: cloudinaryResult.secure_url,
      uploadedBy: rawId, // ⚡ ObjectId sidhe save hoga (User model se relation)
      views: 0
    });

    await newPhoto.save();
    return res.status(201).json({ success: true, message: 'Asset uploaded to Cloudinary & DB!', photo: newPhoto });

  } catch (err) {
    console.error("Cloudinary Upload Error:", err);
    return res.status(500).json({ message: 'Server error during upload' });
  }
});

// 🖼️ 4. GET ALL PHOTOS FOR EXPLORE GALLERY (User Details ke sath)
router.get('/explore-live', async (req, res) => {
  try {
    const photos = await Photo.find()
      .populate('uploadedBy', 'name fullName firstName lastName')
      .sort({ createdAt: -1 });

    return res.status(200).json(photos);
  } catch (err) {
    return res.status(500).json({ message: 'Error fetching explore stream' });
  }
});

module.exports = router;