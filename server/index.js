const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { fetch } = require("undici");
const User = require("./models/user");
require("dotenv").config();
const transactionRoutes = require("./routes/transactionRoutes");
const app = express();
app.use(express.json());
app.use(cors());

// Connect to MongoDB
mongoose
  .connect("mongodb://localhost:27017/minor", { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// User Registration
app.post("/register", async (req, res) => {
    try {
        const { username, email, password, securityQuestions } = req.body;

        if (!securityQuestions || securityQuestions.length === 0) {
            return res.status(400).json({ error: "At least one security question is required." });
        }

        const newUser = new User({
            username,
            email,
            password,  // You should hash this before saving (bcrypt recommended)
            securityQuestions
        });

        await newUser.save();
        res.status(201).json({ message: "User registered successfully!" });
    } catch (err) {
        res.status(500).json({ error: "Registration failed", details: err });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.json({ success: false, message: "User not found" });
        if (user.password !== password) return res.json({ success: false, message: "Incorrect password" });

        // Pick a random security question
        const randomIndex = Math.floor(Math.random() * user.securityQuestions.length);
        const selectedQuestion = user.securityQuestions[randomIndex].question;

        res.json({ success: true, securityQuestion: selectedQuestion });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error", error: err });
    }
});

app.post("/verify-security", async (req, res) => {
    try {
        const { email, securityAnswer } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.json({ success: false, message: "User not found" });

        const isValid = user.securityQuestions.some(q => q.answer.toLowerCase() === securityAnswer.toLowerCase());

        if (isValid) {
            // Return user data without password
            const userData = {
                id: user._id,
                username: user.username,
                email: user.email,
                balance: user.balance
            };
            res.json({ success: true, user: userData });
        } else {
            res.json({ success: false, message: "Incorrect security answer" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error", error: err });
    }
});

app.post("/analyze-transcript", async (req, res) => {
    try {
        const API_KEY = process.env.OPENROUTER_API_KEY;
        const { transcript } = req.body;
        if (!transcript) return res.status(400).json({ error: "Transcript is required" });

        console.log("Received transcript for analysis:", transcript);
        console.log("Using API key:", API_KEY ? "API key found" : "API key missing");

        // Define the strict JSON response prompt
        const PROMPT_TEMPLATE = `STRICTLY respond in this JSON format:
        {
          "intent": "make_payment|check_balance|check_history",
          "parameters": {{
            "name": "(string)",
            "amount": (number)
          }},
          "clarification_message": "(string)"
        }

        Examples:
        1. Command: "Send ₹500 to Ravi"
        Response: {{"intent":"make_payment","parameters":{{"name":"Ravi","amount":500}},"clarification_message":""}}

        2. Command: "Check balance"
        Response: {{"intent":"check_balance","parameters":{{"name":"","amount":""}},"clarification_message":""}}

        3. Command: "Wire money to colleague"
        Response: {{"intent":"make_payment","parameters":{{"name":"colleague","amount":""}},"clarification_message":"How much would you like to send to colleague?"}}

        Now process: ${transcript}`;

        try {
            // Call OpenRouter API (Google Gemini Model)
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "google/gemini-2.5-pro-exp-03-25:free",
                    messages: [{ role: "user", content: PROMPT_TEMPLATE }],
                    temperature: 0,
                    max_tokens: 10000
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`API request failed: ${errorText}`);
                throw new Error(`API request failed: ${errorText}`);
            }

            const data = await response.json();
            console.log("Raw AI Response:", data);
            const aiResult = data.choices?.[0]?.message?.content || "{}";
            console.log("AI Response:", aiResult);
            const cleanedResult = aiResult.replace(/```json|```/g, "").trim();
            console.log("Cleaned AI Response:", cleanedResult);
            
            // Parse JSON response
            let parsedResult;
            try {
                parsedResult = JSON.parse(cleanedResult);
                res.json(parsedResult);
            } catch (parseError) {
                console.error("JSON Parsing Error:", parseError, "AI Response:", cleanedResult);
                throw new Error("Invalid AI response format");
            }
        } catch (apiError) {
            console.log("API error, using fallback processing...");
            
            // Fallback: Basic intent detection when API fails
            const lowerTranscript = transcript.toLowerCase();
            let fallbackResponse;
            
            // Check for balance intent - expanded keyword matching
            if (lowerTranscript.includes("balance") || 
                lowerTranscript.includes("how much") || 
                lowerTranscript.includes("kitna") || 
                lowerTranscript.includes("check") || 
                lowerTranscript.includes("account") || 
                lowerTranscript.includes("money") || 
                lowerTranscript.includes("available") ||
                lowerTranscript.includes("kitna paisa")) {
                console.log("Fallback detected: check_balance intent");
                fallbackResponse = {
                    "intent": "check_balance",
                    "parameters": {
                        "name": "",
                        "amount": ""
                    },
                    "clarification_message": ""
                };
            } 
            // Check for transaction history intent - expanded keyword matching
            else if (lowerTranscript.includes("history") || 
                    lowerTranscript.includes("transaction") || 
                    lowerTranscript.includes("transactions") ||
                    lowerTranscript.includes("recent") ||
                    lowerTranscript.includes("last") ||
                    lowerTranscript.includes("previous") ||
                    lowerTranscript.includes("payments") ||
                    lowerTranscript.includes("records") ||
                    lowerTranscript.includes("statement")) {
                console.log("Fallback detected: check_history intent");
                fallbackResponse = {
                    "intent": "check_history",
                    "parameters": {
                        "name": "",
                        "amount": ""
                    },
                    "clarification_message": ""
                };
            } 
            // Check for payment intent
            else if (lowerTranscript.includes("send") || 
                    lowerTranscript.includes("pay") || 
                    lowerTranscript.includes("transfer") || 
                    lowerTranscript.includes("bhejo") || 
                    lowerTranscript.includes("payment") ||
                    lowerTranscript.includes("rupees") ||
                    lowerTranscript.includes("rs") ||
                    lowerTranscript.includes("amount") ||
                    lowerTranscript.includes("rupaye") ||
                    lowerTranscript.includes("de do")) {
                
                // Try to extract payment information using regex
                const nameMatch = lowerTranscript.match(/(?:send|pay|transfer|bhejo)\s+(?:to\s+)?(\w+)|(\w+)\s+ko/i);
                const amountMatch = lowerTranscript.match(/(\d+)/);
                
                // Extract name based on the pattern matched
                let name = "";
                if (nameMatch) {
                    // If the first pattern matched (English pattern)
                    if (nameMatch[1]) {
                        name = nameMatch[1];
                    } 
                    // If the second pattern matched (Hindi pattern "name ko")
                    else if (nameMatch[2]) {
                        name = nameMatch[2];
                    }
                }
                
                const amount = amountMatch ? parseInt(amountMatch[0]) : "";
                
                console.log("Fallback detected: make_payment intent with name:", name, "amount:", amount);
                fallbackResponse = {
                    "intent": "make_payment",
                    "parameters": {
                        "name": name,
                        "amount": amount
                    },
                    "clarification_message": !amount ? "Please specify an amount to send." : ""
                };
            } else {
                // If no clear intent matches, try to determine the most likely intent
                // Count keywords related to each intent
                const balanceKeywords = ["balance", "money", "account", "check", "available"];
                const historyKeywords = ["history", "transaction", "statement", "record", "payment"];
                const paymentKeywords = ["send", "pay", "transfer", "bhejo", "amount", "rupees"];
                
                let balanceScore = 0;
                let historyScore = 0;
                let paymentScore = 0;
                
                // Count word matches for each intent
                balanceKeywords.forEach(word => {
                    if (lowerTranscript.includes(word)) balanceScore++;
                });
                
                historyKeywords.forEach(word => {
                    if (lowerTranscript.includes(word)) historyScore++;
                });
                
                paymentKeywords.forEach(word => {
                    if (lowerTranscript.includes(word)) paymentScore++;
                });
                
                // Determine intent based on highest score
                console.log("Intent scores - Balance:", balanceScore, "History:", historyScore, "Payment:", paymentScore);
                
                if (balanceScore >= historyScore && balanceScore >= paymentScore) {
                    fallbackResponse = {
                        "intent": "check_balance",
                        "parameters": {
                            "name": "",
                            "amount": ""
                        },
                        "clarification_message": ""
                    };
                } else if (historyScore >= balanceScore && historyScore >= paymentScore) {
                    fallbackResponse = {
                        "intent": "check_history",
                        "parameters": {
                            "name": "",
                            "amount": ""
                        },
                        "clarification_message": ""
                    };
                } else {
                    // Default to payment but without extracted values if unclear
                    fallbackResponse = {
                        "intent": "make_payment",
                        "parameters": {
                            "name": "",
                            "amount": ""
                        },
                        "clarification_message": "Please specify who you want to pay and how much."
                    };
                }
            }
            
            console.log("Fallback response:", fallbackResponse);
            res.json(fallbackResponse);
        }
    } catch (error) {
        console.error("AI Analysis Error:", error);
        res.status(500).json({ error: "Failed to fetch AI analysis" });
    }
});

app.get("/search-users", async (req, res) => {
    try {
        const { name } = req.query;

        if (!name || name.trim().length < 2) {
            return res.json({ message: "No similar contacts exist", data: [] });
        }

        const trimmedName = name.trim();
        const nameParts = trimmedName.split(" ");
        const halfLength = Math.ceil(trimmedName.length / 2);
        
        const firstHalf = trimmedName.substring(0, halfLength);
        const secondHalf = trimmedName.substring(halfLength);

        const searchRegex = new RegExp(`${firstHalf}|${secondHalf}`, 'i');

        // Find users with matching name parts
        const users = await User.find(
            { username: searchRegex }, // Searching only by username
            'username email' // Selecting only required fields
        ).limit(5).lean();

        if (users.length === 0) {
            return res.json({ message: "No similar contacts exist", data: [] });
        }

        // Formatting response
        const suggestions = users.map(user => ({
            id: user._id,
            name: user.username,
            email: user.email
        }));

        res.json({ message: "", data: suggestions });

    } catch (error) {
        console.error("Error fetching user suggestions:", error);
        res.status(500).json({ message: "Server error", data: [] });
    }
});

app.get("/user/:email", async (req, res) => {
    try {
        const { email } = req.params;
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Return user data without password
        const userData = {
            id: user._id,
            username: user.username,
            email: user.email,
            balance: user.balance
        };

        res.json({ success: true, user: userData });
    } catch (error) {
        console.error("Error fetching user data:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.get("/user/id/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Return user data without password
        const userData = {
            id: user._id,
            username: user.username,
            email: user.email,
            balance: user.balance
        };

        res.json({ success: true, user: userData });
    } catch (error) {
        console.error("Error fetching user data:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.post("/make-payment", async (req, res) => {
    try {
        const { receiver, amount, senderEmail } = req.body;
        const numericAmount = parseFloat(amount);

        if (!receiver || isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid payment details" 
            });
        }

        // For now, just return success - in a real app, we would validate the receiver
        // and update account balances in the database
        res.json({ 
            success: true, 
            message: `Payment of ₹${numericAmount} to ${receiver} processed`
        });
    } catch (error) {
        console.error("Payment Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.listen(3001, () => console.log("Server running on port 3001"));