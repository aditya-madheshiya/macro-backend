const mongoose = require('mongoose');

const PhotoSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true
  },
  price: {
    type: String, // क्योंकि फ्रंटएंड से हम '$25' भेज रहे हैं, इसलिए String रखना सेफ है
    required: true
  },
  magnification: {
    type: String,
    default: "Macro Shot"
  },
  imageUrl: {
    type: String, // 🎯 यहाँ सिर्फ Cloudinary का लिंक (URL) टेक्स्ट के रूप में आएगा
    required: true
  },
  uploadedBy: {
    type: String, // अभी टेस्टिंग के लिए हम डमी स्ट्रिंग आईडी भेज रहे हैं
    required: true
  },
  views: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Photo', PhotoSchema);