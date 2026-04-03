require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
// Exposes the 'public' folder so you can call /images/pic.png in your HTML
app.use(express.static(path.join(__dirname, 'public')));

// 1. Create a Connection Pool
// This stays "alive" and reuses connections for every vote
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 2. The Vote Endpoint
app.post('/vote', async (req, res) => {
    const { selection } = req.body;
    const userIp = req.ip || req.connection.remoteAddress;

    try {
         // 1. COUNT how many times this IP appeared in the last 24 hours
        const [rows] = await pool.execute(
            'SELECT COUNT(*) as voteCount FROM votes WHERE user_ip = ? AND created_at > NOW() - INTERVAL 1 DAY',
            [userIp]
        );

        const voteCount = rows[0].voteCount;

        // 2. Check if they hit the limit of 5
        if (voteCount >= 5) {
            return res.status(429).json({ 
                message: "Rate limit exceeded. You can only vote 5 times every 24 hours." 
            });
        }

        // ------------------------

        // Acquisition of a connection from the pool is automatic with .execute()
        const [result] = await pool.execute(
            'INSERT INTO votes (selection, user_ip) VALUES (?, ?)',
            [selection, userIp]
        );
        
        console.log(`Vote saved! ID: ${result.insertId}`);
        res.status(200).json({ message: "Vote recorded!", id: result.insertId });
    } catch (err) {
        console.error("Database Error:", err);
        res.status(500).json({ message: "Failed to save vote to database." });
    }
});

app.get('/results', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT selection, COUNT(*) as count FROM votes GROUP BY selection'
        );
        
        let results = { Minato: 0, Itachi: 0, total: 0 };
        rows.forEach(row => {
            results[row.selection] = row.count;
            results.total += row.count;
        });

        // Calculate percentages (default to 50/50 if no votes yet)
        const minatoPer = results.total ? Math.round((results.Minato / results.total) * 100) : 50;
        const itachiPer = results.total ? Math.round((results.Itachi / results.total) * 100) : 50;

        res.json({ minatoPer, itachiPer });
    } catch (err) {
        res.status(500).send(err);
    }
});

// Health Check Route
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});


const initDb = async (retries = 25) => {
  const schema = `
    CREATE TABLE IF NOT EXISTS votes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      selection VARCHAR(255) NOT NULL,
      user_ip VARCHAR(45) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (user_ip)
    );`;

  while (retries > 0) {
    try {
      await pool.execute(schema);
      console.log("✅ Database schema verified/created.");
      return; // Exit loop on success
    } catch (err) {
      retries--;
      console.error(`❌ DB not ready. Retrying... (${retries} left)`);
      // Wait 5 seconds before trying again
      await new Promise(res => setTimeout(res, 5000));
    }
  }
  console.error("🛑 Could not connect to DB after multiple attempts.");
};


initDb(); // Run this on startup




// 3. Start the Server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
