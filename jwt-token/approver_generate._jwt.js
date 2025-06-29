const jwt = require('jsonwebtoken');

const payload = {
  "userId": "approver456",
  "email": "terinchris2005@gmail.com",
  "role": "Approver"
};


const secret = 'your-super-secret-jwt-key'; 

const token = jwt.sign(payload, secret, { algorithm: 'HS256' });

console.log(token);