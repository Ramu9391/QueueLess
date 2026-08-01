require("dotenv").config();

// ========================================
// DNS SETUP
// ========================================

const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);


// ========================================
// IMPORT PACKAGES
// ========================================

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const otpGenerator = require("otp-generator");

const app = express();

// ========================================
// NODEMAILER CONFIGURATION
// ========================================

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ========================================
// OTP STORAGE
// ========================================

const otpStore = {};


// ========================================
// MIDDLEWARE
// ========================================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/login.html");
});


// ========================================
// CONNECT TO MONGODB
// ========================================

mongoose
    .connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB connected successfully");
    })
    .catch((error) => {
        console.error("MongoDB connection error:", error);
    });


// ========================================
// USER SCHEMA
// ========================================

const userSchema = new mongoose.Schema({

    name: {
        type: String,
        required: true,
        trim: true
    },

    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },

    password: {
        type: String,
        required: true
    }

});

const User = mongoose.model("User", userSchema);


// ========================================
// QUEUE TOKEN SCHEMA
// ========================================

const queueTokenSchema = new mongoose.Schema({

    userId: {
        type: String,
        required: true
    },

    service: {
        type: String,
        required: true
    },

    tokenNumber: {
        type: String,
        required: true
    },

    status: {
        type: String,
        default: "waiting"
    },

    createdAt: {
        type: Date,
        default: Date.now
    },

    cancelledAt: {
        type: Date,
        default: null
    },

    completedAt: {
        type: Date,
        default: null
    }

});

const QueueToken = mongoose.model(
    "QueueToken",
    queueTokenSchema
);


// ========================================
// TEST ROUTE
// ========================================

app.get("/api/test", (req, res) => {

    console.log("TEST REQUEST RECEIVED");

    return res.status(200).json({
        message: "QueueLess backend is working"
    });

});


// ========================================
// REGISTER
// ========================================

console.log("ADMIN LOGIN ROUTE LOADED");
app.post("/api/register", async (req, res) => {

    console.log("");
    console.log("===============================");
    console.log("REGISTER REQUEST RECEIVED");
    console.log("===============================");

    try {

        let { name, email, password } = req.body;

        if (!name || !email || !password) {

            return res.status(400).json({
                message: "Please fill all fields"
            });

        }

        name = name.trim();
        email = email.trim().toLowerCase();

        if (password.length < 6) {

            return res.status(400).json({
                message: "Password must be at least 6 characters"
            });

        }

        const existingUser = await User.findOne({
            email: email
        });

        if (existingUser) {

            return res.status(400).json({
                message: "Account already exists"
            });

        }

        const hashedPassword = await bcrypt.hash(
            password,
            10
        );

        const user = new User({

            name: name,
            email: email,
            password: hashedPassword

        });

        await user.save();

        console.log("USER SAVED SUCCESSFULLY");

        return res.status(201).json({
            message: "Account created successfully"
        });

    } catch (error) {

        console.error(
            "REGISTRATION ERROR:",
            error
        );

        if (error.code === 11000) {

            return res.status(400).json({
                message: "Account already exists"
            });

        }

        return res.status(500).json({
            message: "Server error"
        });

    }

});


// ========================================
// LOGIN
// ========================================

app.post("/api/login", async (req, res) => {

    console.log("");
    console.log("===============================");
    console.log("LOGIN REQUEST RECEIVED");
    console.log("===============================");

    try {

        let { email, password } = req.body;

        if (!email || !password) {

            return res.status(400).json({
                message: "Please enter email and password"
            });

        }

        email = email.trim().toLowerCase();

        const user = await User.findOne({
            email: email
        });

        if (!user) {

            console.log("LOGIN FAILED: USER NOT FOUND");

            return res.status(401).json({
                message: "Invalid email or password"
            });

        }

        const correctPassword = await bcrypt.compare(
            password,
            user.password
        );

        if (!correctPassword) {

            console.log("LOGIN FAILED: WRONG PASSWORD");

            return res.status(401).json({
                message: "Invalid email or password"
            });

        }

        const token = jwt.sign(

            {
                userId: user._id.toString(),
                email: user.email
            },

            process.env.JWT_SECRET,

            {
                expiresIn: "1d"
            }

        );

        console.log("LOGIN SUCCESSFUL");
        console.log("User:", user.email);
        console.log(
            "User ID:",
            user._id.toString()
        );

        return res.status(200).json({

            message: "Login successful",

            token: token,

            name: user.name,

            email: user.email,

            userId: user._id.toString()

        });

    } catch (error) {

        console.error(
            "LOGIN ERROR:",
            error
        );

        return res.status(500).json({
            message: "Server error"
        });

    }

});


// ========================================
// JOIN QUEUE
// ========================================

app.post("/api/join-queue", async (req, res) => {

    console.log("");
    console.log("===============================");
    console.log("JOIN QUEUE REQUEST RECEIVED");
    console.log("===============================");

    try {

        const {
            service,
            userId
        } = req.body;

        console.log("Service:", service);
        console.log("User ID:", userId);

        if (!service || !userId) {

            return res.status(400).json({
                message: "Service and user are required"
            });

        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {

            return res.status(400).json({
                message: "Invalid user"
            });

        }

        const user = await User.findById(userId);

        if (!user) {

            return res.status(404).json({
                message: "User not found"
            });

        }


        // ========================================
        // CHECK ACTIVE TOKEN
        // ========================================

        const existingToken = await QueueToken.findOne({

            userId: userId,
            status: "waiting"

        });

        if (existingToken) {

            return res.status(400).json({

                message: "You already have an active token",

                tokenNumber: existingToken.tokenNumber,

                service: existingToken.service

            });

        }


        // ========================================
        // SERVICE PREFIXES
        // ========================================

        const prefixes = {

            "College Administration": "A",

            "Accounts & Fee Counter": "F",

            "Library": "L",

            "Hostel Office": "H",

            "IT Help Desk": "IT",

            "General Enquiry": "G",

            "College Canteen": "C",

            "Cafe / Food Court": "FC",

            "Transport Office": "T",

            "Campus Medical Center": "M",

            "Exam Cell": "E",

            "Placement Cell": "P"

        };

        const prefix = prefixes[service];

        if (!prefix) {

            console.log("INVALID SERVICE:", service);

            return res.status(400).json({
                message: "Invalid service"
            });

        }


        // ========================================
        // START OF TODAY
        // ========================================

        const startOfToday = new Date();

        startOfToday.setHours(
            0,
            0,
            0,
            0
        );


        // ========================================
        // COUNT TOKENS FOR SERVICE TODAY
        // ========================================

        const count = await QueueToken.countDocuments({

            service: service,

            createdAt: {
                $gte: startOfToday
            }

        });


        // ========================================
        // GENERATE TOKEN NUMBER
        // ========================================

        const tokenNumber =

            prefix +

            "-" +

            String(count + 1).padStart(
                3,
                "0"
            );

        console.log(
            "Generated token:",
            tokenNumber
        );


        // ========================================
        // SAVE TOKEN
        // ========================================

        const queueToken = new QueueToken({

            userId: userId,

            service: service,

            tokenNumber: tokenNumber,

            status: "waiting"

        });

        await queueToken.save();

        console.log(
            "TOKEN SAVED SUCCESSFULLY:",
            tokenNumber
        );


        // ========================================
        // CALCULATE INITIAL QUEUE POSITION
        // ========================================

        const peopleAhead = await QueueToken.countDocuments({

            service: service,

            status: "waiting",

            createdAt: {
                $lt: queueToken.createdAt
            }

        });

        const position = peopleAhead + 1;

        const estimatedWait = peopleAhead * 5;


        return res.status(201).json({

            message: "Queue joined successfully",

            tokenNumber: tokenNumber,

            service: service,

            status: "waiting",

            createdAt: queueToken.createdAt,

            position: position,

            peopleAhead: peopleAhead,

            estimatedWait: estimatedWait,

            isNext: position === 1

        });

    } catch (error) {

        console.error(
            "JOIN QUEUE ERROR:",
            error
        );

        return res.status(500).json({
            message: "Server error while joining queue"
        });

    }

});


// ========================================
// GET USER ACTIVE TOKEN + LIVE POSITION
// ========================================

app.get(
    "/api/my-token/:userId",
    async (req, res) => {

        console.log("");
        console.log("===============================");
        console.log("GET ACTIVE TOKEN REQUEST");
        console.log("===============================");

        try {

            const userId = req.params.userId;

            if (!mongoose.Types.ObjectId.isValid(userId)) {

                return res.status(400).json({
                    message: "Invalid user"
                });

            }


            // ========================================
            // FIND ACTIVE TOKEN
            // ========================================

            const queueToken = await QueueToken
                .findOne({

                    userId: userId,

                    status: "waiting"

                })
                .sort({

                    createdAt: -1

                });


            if (!queueToken) {

                return res.status(404).json({
                    message: "No active token found"
                });

            }


            // ========================================
            // COUNT PEOPLE AHEAD
            // ========================================

            const peopleAhead =
                await QueueToken.countDocuments({

                    service: queueToken.service,

                    status: "waiting",

                    createdAt: {
                        $lt: queueToken.createdAt
                    }

                });


            // ========================================
            // POSITION
            // ========================================

            const position =
                peopleAhead + 1;


            // ========================================
            // ESTIMATED WAIT
            // 5 MINUTES PER PERSON
            // ========================================

            const minutesPerPerson = 5;

            const estimatedWait =
                peopleAhead * minutesPerPerson;


            console.log(
                "Token:",
                queueToken.tokenNumber
            );

            console.log(
                "Service:",
                queueToken.service
            );

            console.log(
                "Position:",
                position
            );

            console.log(
                "People ahead:",
                peopleAhead
            );

            console.log(
                "Estimated wait:",
                estimatedWait,
                "minutes"
            );


            // ========================================
            // RETURN LIVE QUEUE DATA
            // ========================================

            return res.status(200).json({

                success: true,

                tokenNumber:
                    queueToken.tokenNumber,

                service:
                    queueToken.service,

                status:
                    queueToken.status,

                createdAt:
                    queueToken.createdAt,

                position:
                    position,

                peopleAhead:
                    peopleAhead,

                estimatedWait:
                    estimatedWait,

                isNext:
                    position === 1

            });

        } catch (error) {

            console.error(
                "GET TOKEN ERROR:",
                error
            );

            return res.status(500).json({
                message: "Server error"
            });

        }

    }
);


// ========================================
// CANCEL ACTIVE TOKEN
// ========================================

app.post(
    "/api/cancel-token",
    async (req, res) => {

        console.log("");
        console.log("===============================");
        console.log("CANCEL TOKEN REQUEST");
        console.log("===============================");

        try {

            const {
                userId
            } = req.body;

            console.log(
                "Cancel requested by:",
                userId
            );

            if (!userId) {

                return res.status(400).json({
                    message: "User ID is required"
                });

            }

            if (!mongoose.Types.ObjectId.isValid(userId)) {

                return res.status(400).json({
                    message: "Invalid user"
                });

            }


            // ========================================
            // FIND ACTIVE TOKEN
            // ========================================

            const activeToken = await QueueToken.findOne({

                userId: userId,

                status: "waiting"

            });

            if (!activeToken) {

                return res.status(404).json({
                    message: "No active token found"
                });

            }


            // ========================================
            // CANCEL TOKEN
            // ========================================

            activeToken.status = "cancelled";

            activeToken.cancelledAt = new Date();

            await activeToken.save();

            console.log(
                "TOKEN CANCELLED:",
                activeToken.tokenNumber
            );

            return res.status(200).json({

                success: true,

                message: "Token cancelled successfully",

                tokenNumber: activeToken.tokenNumber,

                service: activeToken.service,

                status: activeToken.status,

                cancelledAt: activeToken.cancelledAt

            });

        } catch (error) {

            console.error(
                "CANCEL TOKEN ERROR:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Server error while cancelling token"

            });

        }

    }
);


// ========================================
// GET QUEUE HISTORY
// ========================================

app.get(
    "/api/queue-history/:userId",
    async (req, res) => {

        console.log("");
        console.log("===============================");
        console.log("QUEUE HISTORY REQUEST");
        console.log("===============================");

        try {

            const userId = req.params.userId;

            console.log(
                "History User ID:",
                userId
            );


            // ========================================
            // VALIDATE USER ID
            // ========================================

            if (!userId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "User ID is required"

                });

            }

            if (!mongoose.Types.ObjectId.isValid(userId)) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid user"

                });

            }


            // ========================================
            // CHECK USER EXISTS
            // ========================================

            const user =
                await User.findById(userId);

            if (!user) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User not found"

                });

            }


            // ========================================
            // FIND HISTORY
            // ========================================

            const history =
                await QueueToken
                    .find({

                        userId: userId,

                        status: {
                            $in: [
                                "cancelled",
                                "completed"
                            ]
                        }

                    })
                    .sort({

                        createdAt: -1

                    });


            console.log(
                "History records found:",
                history.length
            );


            // ========================================
            // SEND HISTORY
            // ========================================

            return res.status(200).json({

                success: true,

                count: history.length,

                history: history

            });

        } catch (error) {

            console.error(
                "QUEUE HISTORY ERROR:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Server error while loading queue history"

            });

        }

    }
);

// ========================================
// GET LIVE QUEUE POSITION
// ========================================

app.get("/api/queue-position/:userId", async (req, res) => {

    console.log("");
    console.log("===============================");
    console.log("QUEUE POSITION REQUEST");
    console.log("===============================");

    try {

        const userId = req.params.userId;

        console.log("User ID:", userId);

        // ========================================
        // VALIDATE USER ID
        // ========================================

        if (!userId) {

            return res.status(400).json({
                success: false,
                message: "User ID is required"
            });

        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {

            return res.status(400).json({
                success: false,
                message: "Invalid user"
            });

        }


        // ========================================
        // FIND USER ACTIVE TOKEN
        // ========================================

        const activeToken = await QueueToken
            .findOne({
                userId: userId,
                status: "waiting"
            })
            .sort({
                createdAt: -1
            });


        if (!activeToken) {

            return res.status(404).json({
                success: false,
                message: "No active token found"
            });

        }


        // ========================================
        // COUNT PEOPLE AHEAD
        // SAME SERVICE ONLY
        // ========================================

        const peopleAhead = await QueueToken.countDocuments({

            service: activeToken.service,

            status: "waiting",

            createdAt: {
                $lt: activeToken.createdAt
            }

        });


        // ========================================
        // CALCULATE POSITION
        // ========================================

        const position = peopleAhead + 1;


        // ========================================
        // ESTIMATED WAIT
        // 5 MINUTES PER PERSON
        // ========================================

        const minutesPerPerson = 5;

        const estimatedWait =
            peopleAhead * minutesPerPerson;


        // ========================================
        // TOTAL PEOPLE WAITING
        // ========================================

        const totalWaiting =
            await QueueToken.countDocuments({

                service: activeToken.service,

                status: "waiting"

            });


        // ========================================
        // CHECK IF USER IS NEXT
        // ========================================

        const isNext = position === 1;


        console.log("Token:", activeToken.tokenNumber);
        console.log("Service:", activeToken.service);
        console.log("Position:", position);
        console.log("People Ahead:", peopleAhead);
        console.log("Estimated Wait:", estimatedWait);
        console.log("Total Waiting:", totalWaiting);


        // ========================================
        // SEND RESPONSE
        // ========================================

        return res.status(200).json({

            success: true,

            tokenNumber:
                activeToken.tokenNumber,

            service:
                activeToken.service,

            status:
                activeToken.status,

            createdAt:
                activeToken.createdAt,

            position:
                position,

            peopleAhead:
                peopleAhead,

            estimatedWait:
                estimatedWait,

            totalWaiting:
                totalWaiting,

            isNext:
                isNext

        });


    } catch (error) {

        console.error(
            "QUEUE POSITION ERROR:",
            error
        );

        return res.status(500).json({

            success: false,

            message:
                "Server error while calculating queue position"

        });

    }

});

// ========================================
// ADMIN - GET QUEUE DATA
// ========================================

app.get("/api/admin/queue/:service", async (req, res) => {
    try {
        const service = decodeURIComponent(req.params.service);

        console.log("");
        console.log("===============================");
        console.log("ADMIN QUEUE REQUEST");
        console.log("Service:", service);
        console.log("===============================");

        // All waiting tokens for selected service
        const waitingTokens = await QueueToken.find({
            service: service,
            status: "waiting"
        }).sort({
            createdAt: 1
        });

        // Currently serving token
        const servingToken = await QueueToken.findOne({
            service: service,
            status: "serving"
        }).sort({
            createdAt: 1
        });

        // Start of today
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        // Completed today
        const completedToday = await QueueToken.countDocuments({
            service: service,
            status: "completed",
            completedAt: {
                $gte: startOfToday
            }
        });

        return res.status(200).json({
            success: true,

            service: service,

            nowServing: servingToken
                ? servingToken.tokenNumber
                : null,

            servingToken: servingToken,

            peopleWaiting: waitingTokens.length,

            completedToday: completedToday,

            waitingTokens: waitingTokens
        });

    } catch (error) {
        console.error("ADMIN QUEUE ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Server error while loading admin queue"
        });
    }
});


// ========================================
// ADMIN - CALL NEXT TOKEN
// ========================================

app.post("/api/admin/call-next", async (req, res) => {
    try {
        const { service } = req.body;

        console.log("");
        console.log("===============================");
        console.log("ADMIN CALL NEXT");
        console.log("Service:", service);
        console.log("===============================");

        if (!service) {
            return res.status(400).json({
                success: false,
                message: "Service is required"
            });
        }

        // Check whether someone is already being served
        const currentlyServing = await QueueToken.findOne({
            service: service,
            status: "serving"
        });

        if (currentlyServing) {
            return res.status(400).json({
                success: false,
                message:
                    "Complete the current token before calling the next token",
                tokenNumber: currentlyServing.tokenNumber
            });
        }

        // Find oldest waiting token
        const nextToken = await QueueToken.findOne({
            service: service,
            status: "waiting"
        }).sort({
            createdAt: 1
        });

        if (!nextToken) {
            return res.status(404).json({
                success: false,
                message: "No waiting tokens"
            });
        }

        // Change waiting -> serving
        nextToken.status = "serving";

        await nextToken.save();

        console.log(
            "NOW SERVING:",
            nextToken.tokenNumber
        );

        return res.status(200).json({
            success: true,

            message: "Next token called",

            tokenNumber: nextToken.tokenNumber,

            service: nextToken.service,

            status: nextToken.status,

            userId: nextToken.userId
        });

    } catch (error) {
        console.error("CALL NEXT ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Server error while calling next token"
        });
    }
});


// ========================================
// ADMIN - COMPLETE CURRENT TOKEN
// ========================================

app.post("/api/admin/complete-current", async (req, res) => {
    try {
        const { service } = req.body;

        console.log("");
        console.log("===============================");
        console.log("ADMIN COMPLETE CURRENT");
        console.log("Service:", service);
        console.log("===============================");

        if (!service) {
            return res.status(400).json({
                success: false,
                message: "Service is required"
            });
        }

        // Find token currently being served
        const currentToken = await QueueToken.findOne({
            service: service,
            status: "serving"
        });

        if (!currentToken) {
            return res.status(404).json({
                success: false,
                message: "No token is currently being served"
            });
        }

        // serving -> completed
        currentToken.status = "completed";
        currentToken.completedAt = new Date();

        await currentToken.save();

        console.log(
            "TOKEN COMPLETED:",
            currentToken.tokenNumber
        );

        return res.status(200).json({
            success: true,

            message: "Token completed successfully",

            tokenNumber: currentToken.tokenNumber,

            service: currentToken.service,

            status: currentToken.status,

            completedAt: currentToken.completedAt
        });

    } catch (error) {
        console.error(
            "COMPLETE TOKEN ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Server error while completing token"
        });
    }
});


// ========================================
// ADMIN - GET ALL SERVICES SUMMARY
// ========================================

app.get("/api/admin/services", async (req, res) => {
    try {

        const services = [
            "College Administration",
            "Accounts & Fee Counter",
            "Library",
            "Hostel Office",
            "IT Help Desk",
            "General Enquiry",
            "College Canteen",
            "Cafe / Food Court",
            "Transport Office",
            "Campus Medical Center",
            "Exam Cell",
            "Placement Cell"
        ];

        const results = [];

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        for (const service of services) {

            const waiting =
                await QueueToken.countDocuments({
                    service: service,
                    status: "waiting"
                });

            const serving =
                await QueueToken.findOne({
                    service: service,
                    status: "serving"
                });

            const completed =
                await QueueToken.countDocuments({
                    service: service,
                    status: "completed",
                    completedAt: {
                        $gte: startOfToday
                    }
                });

            results.push({
                service: service,
                waiting: waiting,
                nowServing: serving
                    ? serving.tokenNumber
                    : null,
                completedToday: completed
            });
        }

        return res.status(200).json({
            success: true,
            services: results
        });

    } catch (error) {

        console.error(
            "ADMIN SERVICES ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// =====================================
// ADMIN LOGIN
// =====================================

app.post("/api/admin/login", (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        if (
            email !== process.env.ADMIN_EMAIL ||
            password !== process.env.ADMIN_PASSWORD
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid admin email or password"
            });
        }

        const adminToken = jwt.sign(
            {
                role: "admin",
                email: process.env.ADMIN_EMAIL
            },
            process.env.JWT_SECRET,
            { expiresIn: "8h" }
        );

        return res.json({
            success: true,
            message: "Admin login successful",
            token: adminToken
        });

    } catch (error) {
        console.error("ADMIN LOGIN ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ========================================
// FORGOT PASSWORD - SEND OTP
// ========================================

app.post("/api/forgot-password", async (req, res) => {
    try {
        let { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required"
            });
        }

        email = email.trim().toLowerCase();

        // Check if user exists
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Email not registered"
            });
        }

        // Generate 6-digit OTP
        const otp = otpGenerator.generate(6, {
            upperCaseAlphabets: false,
            lowerCaseAlphabets: false,
            specialChars: false,
            digits: true
        });

        // Store OTP for 10 minutes
        otpStore[email] = {
            otp,
            expires: Date.now() + 10 * 60 * 1000
        };

        // Send email
        await transporter.sendMail({
            from: `"QueueLess Team" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "QueueLess Password Reset OTP",
            text: `Your OTP is ${otp}. It is valid for 10 minutes.`
        });

        return res.status(200).json({
            success: true,
            message: "OTP sent successfully"
        });

    } catch (error) {
        console.error("FORGOT PASSWORD ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });
    }
});

// ========================================
// VERIFY OTP
// ========================================

app.post("/api/verify-otp", (req, res) => {

    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({
            success: false,
            message: "Email and OTP are required"
        });
    }

    const storedOtp = otpStore[email];

    if (!storedOtp) {
        return res.status(400).json({
            success: false,
            message: "OTP not found. Please request a new OTP."
        });
    }

    if (Date.now() > storedOtp.expires) {
        delete otpStore[email];

        return res.status(400).json({
            success: false,
            message: "OTP has expired."
        });
    }

    if (storedOtp.otp !== otp) {
        return res.status(400).json({
            success: false,
            message: "Invalid OTP."
        });
    }

    return res.status(200).json({
        success: true,
        message: "OTP verified successfully"
    });

});

// ========================================
// RESET PASSWORD
// ========================================

app.post("/api/reset-password", async (req, res) => {

    try {

        const { email, password } = req.body;

        if (!email || !password) {

            return res.status(400).json({

                success:false,

                message:"Email and password are required"

            });

        }

        const user=await User.findOne({email});

        if(!user){

            return res.status(404).json({

                success:false,

                message:"User not found"

            });

        }

        const hashedPassword=await bcrypt.hash(password,10);

        user.password=hashedPassword;

        await user.save();

        delete otpStore[email];

        return res.status(200).json({

            success:true,

            message:"Password reset successfully"

        });

    }

    catch(error){

        console.error(error);

        return res.status(500).json({

            success:false,

            message:"Server error"

        });

    }

});


// ========================================
// START SERVER
// ========================================

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== "production") {
    app.listen(PORT, () => {
        console.log(`QueueLess server running on port ${PORT}`);
    });
}

module.exports = app;