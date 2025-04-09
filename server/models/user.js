const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    username: String,
    email: { type: String, unique: true },
    password: String, 
    securityQuestions: [{ question: String, answer: String }],
    balance: { type: Number, default: 10000 }
});

module.exports = mongoose.model("User", userSchema);
