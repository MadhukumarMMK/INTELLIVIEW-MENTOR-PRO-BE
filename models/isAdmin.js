const isAdmin = (req, res, next) => {
    // Assumes req.user is populated by your authentication middleware (e.g., JWT verification)
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ 
            success: false, 
            message: "Access denied. Administrator privileges required." 
        });
    }
};

module.exports = isAdmin;