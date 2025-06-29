const jwt = require('jsonwebtoken');

const payload = {
  "userId": "user123",
  "email": "terinchris2005@gmail.com",
  "role": "User"
};


const secret = 'your-super-secret-jwt-key'; 

const token = jwt.sign(payload, secret, { algorithm: 'HS256' });

console.log(token);