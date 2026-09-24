require('dotenv').config(); // ⚡ Sabse upar load karein
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const paymentRoutes = require('./routes/paymentRoutes');
const app = express();

// ⚡ CORS Setup (Local aur Live dono jagah chalne ke liye)
app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(express.json());

// 🗄️ Database Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('🚀 MongoDB Connected Seamlessly...');
  } catch (err) {
    console.error('Database connection error:', err.message);
    process.exit(1);
  }
};
connectDB();

// 🛣️ Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/photos', require('./routes/photoRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/payments', paymentRoutes);

// Root Health Check Route (Deploy hone ke baad test karne ke liye)
app.get('/', (req, res) => {
  res.send('API is running successfully!');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🌍 Server node running active on port ${PORT}`));