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
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

// ========================================
// NODEMAILER CONFIGURATION
// ========================================

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ========================================
// OTP STORAGE
// ========================================

const otpStore = {};

// ADMIN LOGIN OTP STORAGE
const adminOtpStore = {};

// ========================================
// CAPTCHA STORAGE
// ========================================

const captchaStore = {};

// ========================================
// REGISTER EMAIL OTP STORAGE
// ========================================

const registerOtpStore = {};


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

    phone: {
        type: String,
        required: false,
        unique: true,
        sparse: true,
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
},

rejectedAt: {
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
// REAL IMAGE CAPTCHA
// ========================================

const captchaCategories = [
    "cars",
    "buses",
    "bicycles",
    "motorcycles",
    "stop-signs",
    "traffic-lights",
    "airplanes",
    "boats",
    "trains",
    "dogs"
];

const captchaImageFolder = path.join(
    __dirname,
    "captcha-images"
);


// Get all real images from a category folder
function getCategoryImages(category) {

    const folder = path.join(
        captchaImageFolder,
        category
    );

    if (!fs.existsSync(folder)) {
        console.error("CAPTCHA FOLDER NOT FOUND:", folder);
        return [];
    }

    return fs.readdirSync(folder)
        .filter(file =>
            /\.(jpg|jpeg|png|webp)$/i.test(file)
        );
}


// Shuffle array
function shuffle(array) {

    return [...array].sort(
        () => Math.random() - 0.5
    );

}


// ========================================
// CREATE CAPTCHA
// ========================================

app.get("/api/captcha", (req, res) => {

    try {

        const captchaId =
            crypto.randomUUID();


        // Random target category
        const target =
            captchaCategories[
                Math.floor(
                    Math.random() *
                    captchaCategories.length
                )
            ];


        // ========================================
        // GET TARGET IMAGES
        // ========================================

        const targetImages =
            shuffle(
                getCategoryImages(target)
            );


        // We need 4 correct images
        const correctImages =
            targetImages.slice(0, 4);


        // ========================================
        // GET OTHER CATEGORY IMAGES
        // ========================================

        let otherImages = [];


        for (
            const category of captchaCategories
        ) {

            if (category === target) {
                continue;
            }


            const files =
                getCategoryImages(category);


            files.forEach(file => {

                otherImages.push({

                    category: category,

                    file: file

                });

            });

        }


        // Shuffle all wrong images
        otherImages =
            shuffle(otherImages);


        // Need 12 wrong images
        const wrongImages =
            otherImages.slice(0, 12);


        // ========================================
        // CREATE 16 IMAGE GRID
        // ========================================

        const allImages = [];


        // Correct images
        correctImages.forEach(file => {

            allImages.push({

                category: target,

                file: file,

                correct: true

            });

        });


        // Wrong images
        wrongImages.forEach(item => {

            allImages.push({

                category: item.category,

                file: item.file,

                correct: false

            });

        });


        // Mix everything
        const mixedImages =
            shuffle(allImages);


        // Correct indexes
        const correctIndexes = [];


        const images =
            mixedImages.map(
                (item, index) => {

                    if (item.correct) {

                        correctIndexes.push(index);

                    }


                    return {

                        index: index,

                        image:
                            `/captcha-images/${item.category}/${encodeURIComponent(item.file)}`

                    };

                }
            );


        // ========================================
        // SAVE CAPTCHA
        // ========================================

        captchaStore[captchaId] = {

            target: target,

            correctIndexes:
                correctIndexes,

            expires:
                Date.now() +
                2 * 60 * 1000,

            verified: false

        };


        // ========================================
        // SEND CAPTCHA
        // ========================================

        return res.status(200).json({

            captchaId:
                captchaId,

            question:
                `Select all images containing ${target}`,

            images:
                images

        });


    } catch (error) {

        console.error(
            "CAPTCHA GENERATION ERROR:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Could not generate CAPTCHA"

        });

    }

});

    

// ========================================
// VERIFY CAPTCHA
// ========================================

app.post("/api/verify-captcha", (req, res) => {

    try {

        const {
            captchaId,
            selectedIndexes
        } = req.body;

        if (
            !captchaId ||
            !Array.isArray(selectedIndexes)
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "CAPTCHA verification required"
            });
        }

        const captcha =
            captchaStore[captchaId];

        if (!captcha) {

            return res.status(400).json({

                success: false,

                message:
                    "CAPTCHA expired. Please try again."
            });
        }

        if (Date.now() > captcha.expires) {

            delete captchaStore[captchaId];

            return res.status(400).json({

                success: false,

                message:
                    "CAPTCHA expired. Please try again."
            });
        }

        const selected =
            [...selectedIndexes]
                .map(Number)
                .sort((a, b) => a - b);

        const correct =
            [...captcha.correctIndexes]
                .sort((a, b) => a - b);

        const isCorrect =
            selected.length === correct.length &&
            selected.every(
                (value, index) =>
                    value === correct[index]
            );

        if (!isCorrect) {

            return res.status(400).json({

                success: false,

                message:
                    "Incorrect CAPTCHA. Try again."
            });
        }

        captcha.verified = true;

        return res.status(200).json({

            success: true,

            message:
                "CAPTCHA verified"
        });

    } catch (error) {

        console.error(
            "CAPTCHA VERIFY ERROR:",
            error
        );

        return res.status(500).json({

            success: false,

            message:
                "CAPTCHA verification failed"
        });
    }
});


// ========================================
// REGISTER - SEND EMAIL OTP
// ========================================

app.post("/api/send-register-otp", async (req, res) => {

    try {

        let { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required"
            });
        }

        email = email.trim().toLowerCase();

        // Check if email already has an account
        const existingUser = await User.findOne({ email });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "An account already exists with this email"
            });
        }

        // Generate 6 digit OTP
        const otp = otpGenerator.generate(6, {
            upperCaseAlphabets: false,
            lowerCaseAlphabets: false,
            specialChars: false,
            digits: true
        });

        // Store OTP for 10 minutes
        registerOtpStore[email] = {
            otp: otp,
            expires: Date.now() + 10 * 60 * 1000,
            verified: false
        };

        // Send OTP email
        await transporter.sendMail({
            from: `"QueueLess Team" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "QueueLess Email Verification OTP",
            text:
                `Your QueueLess verification OTP is ${otp}.\n\n` +
                `This OTP is valid for 10 minutes.\n\n` +
                `If you did not request this, please ignore this email.`
        });

        console.log("REGISTER OTP SENT TO:", email);

        return res.status(200).json({
            success: true,
            message: "OTP sent to your email"
        });

    } catch (error) {

        console.error("REGISTER OTP ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });

    }

});


// ========================================
// REGISTER - VERIFY EMAIL OTP
// ========================================

app.post("/api/verify-register-otp", (req, res) => {

    try {

        let { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({
                success: false,
                message: "Email and OTP are required"
            });
        }

        email = email.trim().toLowerCase();
        otp = String(otp).trim();

        const savedOtp = registerOtpStore[email];

if (!savedOtp) {
    return res.status(400).json({
        success: false,
        message: "OTP not found. Please request a new OTP."
    });
}

// Check expiry
if (Date.now() > savedOtp.expires) {
    delete registerOtpStore[email];

    return res.status(400).json({
        success: false,
        message: "OTP expired. Please request a new OTP."
    });
}

        // Check OTP
        if (savedOtp.otp !== otp) {
            return res.status(400).json({
                success: false,
                message: "Invalid OTP"
            });
        }

        // Mark email as verified
        registerOtpStore[email].verified = true;

        console.log("EMAIL VERIFIED:", email);

        return res.status(200).json({
            success: true,
            message: "Email verified successfully"
        });

    } catch (error) {

        console.error("REGISTER OTP VERIFY ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "OTP verification failed"
        });

    }

});


// ========================================
// REGISTER
// ========================================

console.log("REGISTER ROUTE LOADED");
app.post("/api/register", async (req, res) => {

    console.log("");
    console.log("===============================");
    console.log("REGISTER REQUEST RECEIVED");
    console.log("===============================");

    try {

        let { name, email, phone, password } = req.body;

        if (!name || !email || !phone || !password) {

            return res.status(400).json({
                message: "Please fill all fields"
            });

        }

        name = name.trim();
        email = email.trim().toLowerCase();
        phone = String(phone || "").replace(/\D/g, "");

if (phone.length === 12 && phone.startsWith("91")) {
    phone = phone.substring(2);
}

        // ========================================
// CHECK EMAIL VERIFICATION
// ========================================

const verification = registerOtpStore[email];

if (!verification || !verification.verified) {

    return res.status(400).json({
        message: "Please verify your email first"
    });

}

        if (password.length < 6) {

            return res.status(400).json({
                message: "Password must be at least 6 characters"
            });

        }

        const existingUser = await User.findOne({
    $or: [
        { email: email },
        { phone: phone }
    ]
});

if (existingUser) {
    if (existingUser.email === email) {
        return res.status(400).json({
            message: "An account already exists with this email"
        });
    }

    if (existingUser.phone === phone) {
        return res.status(400).json({
            message: "An account already exists with this phone number"
        });
    }

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
    phone: phone,
    password: hashedPassword
});


        await user.save();

        delete registerOtpStore[email];

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

        let {
    login,
    password,
    captchaId
} = req.body;

if (!login || !password) {
    return res.status(400).json({
        message: "Please enter email/phone and password"
    });
}


// ========================================
// CHECK CAPTCHA
// ========================================

const captcha =
    captchaStore[captchaId];

if (!captcha || !captcha.verified) {

    return res.status(403).json({

        message:
            "Please complete the CAPTCHA first."
    });
}

delete captchaStore[captchaId];


login = String(login).trim();

        // ========================================
        // NORMALIZE LOGIN VALUE
        // ========================================

        const normalizedEmail = login.toLowerCase();

        // Remove spaces, +91 and other non-digit characters
        let normalizedPhone = login.replace(/\D/g, "");

        // Convert Indian +91XXXXXXXXXX to XXXXXXXXXX
        if (normalizedPhone.length === 12 &&
            normalizedPhone.startsWith("91")) {
            normalizedPhone = normalizedPhone.substring(2);
        }

        console.log("Login entered:", login);
        console.log("Normalized email:", normalizedEmail);
        console.log("Normalized phone:", normalizedPhone);

        // ========================================
        // FIND USER
        // ========================================

        const user = await User.findOne({
    $or: [
        { email: normalizedEmail },
        { phone: normalizedPhone },
        { phone: login },
        { phone: "91" + normalizedPhone },
        { phone: "+91" + normalizedPhone }
    ]
});

        if (!user) {

            console.log("LOGIN FAILED: USER NOT FOUND");

            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        console.log("USER FOUND:", user.email);
        console.log("USER PHONE:", user.phone);

        // ========================================
        // CHECK PASSWORD
        // ========================================

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

        // ========================================
        // CREATE JWT
        // ========================================

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
        console.log("User ID:", user._id.toString());

        return res.status(200).json({

            message: "Login successful",

            token: token,

            name: user.name,

            email: user.email,

            userId: user._id.toString()

        });

    } catch (error) {

        console.error("LOGIN ERROR:", error);

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
// ADMIN - CALL SPECIFIC TOKEN
// ========================================

app.post("/api/admin/call-specific", async (req, res) => {
    try {

        const {
            service,
            tokenNumber
        } = req.body;

        console.log("");
        console.log("===============================");
        console.log("ADMIN CALL SPECIFIC");
        console.log("Service:", service);
        console.log("Token:", tokenNumber);
        console.log("===============================");

        if (!service || !tokenNumber) {
            return res.status(400).json({
                success: false,
                message: "Service and token number are required"
            });
        }

        // Check whether someone is already being served
        const currentlyServing =
            await QueueToken.findOne({
                service: service,
                status: "serving"
            });

        if (currentlyServing) {
            return res.status(400).json({
                success: false,
                message:
                    "Complete or reject the current token before calling another token",
                tokenNumber:
                    currentlyServing.tokenNumber
            });
        }

        // Find the requested waiting token
        const token =
            await QueueToken.findOne({
                service: service,
                tokenNumber: tokenNumber,
                status: "waiting"
            });

        if (!token) {
            return res.status(404).json({
                success: false,
                message:
                    "Token not found or token is not waiting"
            });
        }

        // waiting -> serving
        token.status = "serving";

        await token.save();

        console.log(
            "SPECIFIC TOKEN NOW SERVING:",
            token.tokenNumber
        );

        return res.status(200).json({
            success: true,
            message: "Specific token called successfully",
            tokenNumber: token.tokenNumber,
            service: token.service,
            status: token.status,
            userId: token.userId
        });

    } catch (error) {

        console.error(
            "CALL SPECIFIC TOKEN ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Server error while calling specific token"
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
// ADMIN - REJECT CURRENT TOKEN
// ========================================

app.post("/api/admin/reject-current", async (req, res) => {
    try {

        const { service } = req.body;

        console.log("");
        console.log("===============================");
        console.log("ADMIN REJECT CURRENT");
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

        // serving -> rejected
        currentToken.status = "rejected";
        currentToken.rejectedAt = new Date();

        await currentToken.save();

        console.log(
            "TOKEN REJECTED:",
            currentToken.tokenNumber
        );


        return res.status(200).json({
            success: true,

            message: "Token rejected successfully",

            tokenNumber: currentToken.tokenNumber,

            service: currentToken.service,

            status: currentToken.status,

            rejectedAt: currentToken.rejectedAt
        });

    } catch (error) {

        console.error(
            "REJECT TOKEN ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Server error while rejecting token"
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

// ========================================
// ADMIN LOGIN - PASSWORD + CAPTCHA + OTP
// ========================================

app.post("/api/admin/login", async (req, res) => {

    try {

        const {
            email,
            password,
            captchaId
        } = req.body;

        // ========================================
        // CHECK EMAIL + PASSWORD
        // ========================================

        if (!email || !password) {

            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });

        }

        // ========================================
        // CHECK CAPTCHA
        // ========================================

        const captcha = captchaStore[captchaId];

        if (!captcha || !captcha.verified) {

            return res.status(403).json({
                success: false,
                message: "Please complete the CAPTCHA first."
            });

        }

       // ========================================
// CHECK ADMIN CREDENTIALS
// ========================================

if (
    email.trim().toLowerCase() !==
        process.env.ADMIN_EMAIL.trim().toLowerCase() ||
    password !== process.env.ADMIN_PASSWORD
) {

    // Invalid credentials
    // Keep CAPTCHA untouched so the user can retry
    return res.status(401).json({
        success: false,
        message: "Invalid admin email or password"
    });
}

// ========================================
// CAPTCHA + CREDENTIALS VALID
// ========================================

// Consume CAPTCHA only after credentials are correct
delete captchaStore[captchaId];

        // ========================================
        // GENERATE 6-DIGIT ADMIN OTP
        // ========================================

        const otp = otpGenerator.generate(6, {
            upperCaseAlphabets: false,
            lowerCaseAlphabets: false,
            specialChars: false,
            digits: true
        });

        const adminEmail =
            process.env.ADMIN_EMAIL.trim().toLowerCase();

        // ========================================
        // STORE ADMIN OTP
        // VALID FOR 10 MINUTES
        // ========================================

        adminOtpStore[adminEmail] = {
            otp: otp,
            expires: Date.now() + 10 * 60 * 1000
        };

        // ========================================
        // SEND OTP TO ADMIN EMAIL
        // ========================================

        await transporter.sendMail({

            from:
                `"QueueLess Security" <${process.env.EMAIL_USER}>`,

            to: adminEmail,

            subject:
                "QueueLess Admin Login OTP",

            text:
                `Your QueueLess Admin Login OTP is: ${otp}\n\n` +
                `This OTP is valid for 10 minutes.\n\n` +
                `If you did not attempt to login to the QueueLess Admin Dashboard, please ignore this email.`
        });

        console.log("");
        console.log("================================");
        console.log("ADMIN LOGIN OTP SENT");
        console.log("Admin Email:", adminEmail);
        console.log("================================");

        // ========================================
        // DO NOT CREATE JWT YET
        // ========================================

        return res.status(200).json({

            success: true,

            message:
                "OTP sent to admin email",

            email: adminEmail

        });

    } catch (error) {

        console.error(
            "ADMIN LOGIN OTP ERROR:",
            error
        );

        return res.status(500).json({

            success: false,

            message:
                "Failed to send admin OTP"

        });

    }

});

// ========================================
// ADMIN - VERIFY LOGIN OTP
// ========================================

app.post("/api/admin/verify-otp", (req, res) => {

    try {

        let {
            email,
            otp
        } = req.body;

        // ========================================
        // VALIDATE INPUT
        // ========================================

        if (!email || !otp) {

            return res.status(400).json({

                success: false,

                message:
                    "Email and OTP are required"

            });

        }

        email =
            email.trim().toLowerCase();

        otp =
            String(otp).trim();

        // ========================================
        // ONLY ALLOW THE REAL ADMIN EMAIL
        // ========================================

        if (
            email !==
            process.env.ADMIN_EMAIL.trim().toLowerCase()
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid admin verification request"

            });

        }

        // ========================================
        // GET STORED OTP
        // ========================================

        const savedOtp =
            adminOtpStore[email];

        if (!savedOtp) {

            return res.status(400).json({

                success: false,

                message:
                    "OTP not found. Please login again."

            });

        }

        // ========================================
        // CHECK OTP EXPIRY
        // ========================================

        if (Date.now() > savedOtp.expires) {

            delete adminOtpStore[email];

            return res.status(400).json({

                success: false,

                message:
                    "OTP expired. Please request a new OTP."

            });

        }

        // ========================================
        // CHECK OTP
        // ========================================

        if (savedOtp.otp !== otp) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid OTP"

            });

        }

        // ========================================
        // OTP CORRECT
        // ========================================

        delete adminOtpStore[email];

        // ========================================
        // CREATE ADMIN JWT
        // ========================================

        const adminToken = jwt.sign(

            {
                role: "admin",
                email: email
            },

            process.env.JWT_SECRET,

            {
                expiresIn: "8h"
            }

        );

        console.log("");
        console.log("================================");
        console.log("ADMIN OTP VERIFIED");
        console.log("ADMIN LOGIN SUCCESSFUL");
        console.log("Admin Email:", email);
        console.log("================================");

        // ========================================
        // SEND TOKEN
        // ========================================

        return res.status(200).json({

            success: true,

            message:
                "Admin OTP verified successfully",

            token:
                adminToken

        });

    } catch (error) {

        console.error(
            "ADMIN OTP VERIFY ERROR:",
            error
        );

        return res.status(500).json({

            success: false,

            message:
                "Admin OTP verification failed"

        });

    }

});

// ========================================
// ADMIN - RESEND LOGIN OTP
// ========================================

app.post("/api/admin/send-otp", async (req, res) => {

    try {

        const adminEmail =
            process.env.ADMIN_EMAIL.trim().toLowerCase();

        // ========================================
        // GENERATE NEW OTP
        // ========================================

        const otp = otpGenerator.generate(6, {

            upperCaseAlphabets: false,
            lowerCaseAlphabets: false,
            specialChars: false,
            digits: true

        });

        // ========================================
        // STORE NEW OTP
        // ========================================

        adminOtpStore[adminEmail] = {

            otp: otp,

            expires:
                Date.now() + 10 * 60 * 1000

        };

        // ========================================
        // SEND NEW OTP
        // ========================================

        await transporter.sendMail({

            from:
                `"QueueLess Security" <${process.env.EMAIL_USER}>`,

            to:
                adminEmail,

            subject:
                "QueueLess Admin Login - New OTP",

            text:
                `Your new QueueLess Admin Login OTP is: ${otp}\n\n` +
                `This OTP is valid for 10 minutes.\n\n` +
                `If you did not request this OTP, please ignore this email.`

        });

        console.log(
            "NEW ADMIN OTP SENT TO:",
            adminEmail
        );

        return res.status(200).json({

            success: true,

            message:
                "New OTP sent to admin email"

        });

    } catch (error) {

        console.error(
            "ADMIN RESEND OTP ERROR:",
            error
        );

        return res.status(500).json({

            success: false,

            message:
                "Failed to resend OTP"

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
    expires: Date.now() + 10 * 60 * 1000,
    verified: false
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

// Mark OTP as successfully verified
storedOtp.verified = true;

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

        const storedOtp = otpStore[email];

if (!storedOtp || !storedOtp.verified) {
    return res.status(403).json({
        success: false,
        message: "Please verify OTP first."
    });
}

if (Date.now() > storedOtp.expires) {
    delete otpStore[email];

    return res.status(403).json({
        success: false,
        message: "OTP has expired. Please request a new OTP."
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