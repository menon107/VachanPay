const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema({
    receiver: { type: String, required: true },
    amount: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Transaction", TransactionSchema);
