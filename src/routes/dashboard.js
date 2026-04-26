const path = require('path');
const router = require('express').Router();

router.get('/', async (req, res) => {
    try {
        console.log("Dashboard route hit");

        const filePath = path.join(__dirname, '../../views/dashboard.html');
        console.log("Resolved file path:", filePath);

        res.sendFile(filePath);

    } catch (error) {
        console.error("Dashboard ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
