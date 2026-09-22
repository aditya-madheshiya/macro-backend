const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
  // हेडर से टोकन निकालना
  const token = req.header('Authorization')?.split(' ')[1] || req.header('x-auth-token');

  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    // टोकन वेरीफाई करना
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};