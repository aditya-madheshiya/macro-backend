const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    trim: true,
    default: ''
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  // 🛒 कार्ट एरे (फोटो मॉडल्स की आईडी स्टोर करने के लिए)
  cart: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Photo'
  }],
  // 🖼️ विशलिस्ट/लाइक्स एरे
  likedPhotos: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Photo'
  }],
  // ⚡ खरीदी हुई तस्वीरें (Purchased Assets)
  purchased: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Photo'
  }],
  // 🎯 मिसिंग फील्ड: इसे जोड़ दिया ताकि purchasedPhotos नाम से भी डेटाबेस में सेव हो सके
  purchasedPhotos: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Photo'
  }],
  // 💳 फोटोग्राफर का पेआउट सेटलमेंट वॉलेट एड्रेस
  upiId: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true // इससे createdAt और updatedAt ऑटोमैटिक बन जाते हैं
});

// ⚡ वर्चुअल फील्ड: यूज़र का पूरा नाम निकालने के लिए
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName || ''}`.trim();
});

userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('User', userSchema);