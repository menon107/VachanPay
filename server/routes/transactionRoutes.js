const express = require("express");
const Transaction = require("../models/Transaction");

const router = express.Router();

router.post("/add", async (req, res) => {
    try {
        const { amount, recipient } = req.body;

        if (!amount || !recipient) {
            return res.status(400).json({ error: "Amount and recipient are required" });
        }

        const transaction = new Transaction({ amount, recipient });
        await transaction.save();

        res.status(201).json({ message: "Transaction recorded", transaction });
    } catch (error) {
        console.error("Error recording transaction:", error);
        res.status(500).json({ error: "Failed to record transaction" });
    }
});

module.exports = router;
