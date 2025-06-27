const jwt = require('jsonwebtoken');

const payload = {
  "userId": "testuser1",
  "email": "testuser1@example.com",
  "role": "User"
};


const secret = 'your-super-secret-jwt-key'; 

const token = jwt.sign(payload, secret, { algorithm: 'HS256' });

console.log(token);