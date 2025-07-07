const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "ecommerce.db");
let db = null;

// JWT Secret
const JWT_SECRET = "yourSecretKey";

// DB + Server Init
const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    await createTables(); // optional helper
    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

// ---------------------------------------------
// Optional: Create tables if not exists
const createTables = async () => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT
    );
    CREATE TABLE IF NOT EXISTS product (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      price REAL,
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      product_id INTEGER,
      quantity INTEGER
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      product_id INTEGER,
      quantity INTEGER,
      order_date TEXT
    );
  `);
};

// ---------------------------------------------
// Register User
app.post("/register", async (request, response) => {
  const { username, password, role } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const checkUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(checkUserQuery);
  if (dbUser === undefined) {
    const createUserQuery = `
      INSERT INTO user (username, password, role)
      VALUES ('${username}', '${hashedPassword}', '${role}')
    `;
    await db.run(createUserQuery);
    response.send("User registered successfully");
  } else {
    response.status(400).send("User already exists");
  }
});

// ---------------------------------------------
// Login
app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(getUserQuery);

  if (dbUser && (await bcrypt.compare(password, dbUser.password))) {
    const payload = {
      username: dbUser.username,
      role: dbUser.role,
      id: dbUser.id,
    };
    const jwtToken = jwt.sign(payload, JWT_SECRET);
    response.send({ jwtToken });
  } else {
    response.status(400).send("Invalid credentials");
  }
});

// ---------------------------------------------
// Middleware for JWT Auth
const authenticate = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    const token = authHeader.split(" ")[1];
    jwt.verify(token, JWT_SECRET, (error, payload) => {
      if (error) {
        response.status(401).send("Invalid JWT Token");
      } else {
        request.user = payload;
        next();
      }
    });
  } else {
    response.status(401).send("Authorization header missing");
  }
};

// ---------------------------------------------
// Role Check
const authorize = (role) => {
  return (request, response, next) => {
    if (request.user.role !== role) {
      response.status(403).send("Access denied");
    } else {
      next();
    }
  };
};

// ---------------------------------------------
// Add Product (Admin)
app.post(
  "/products",
  authenticate,
  authorize("admin"),
  async (request, response) => {
    const { name, price, description } = request.body;
    const query = `INSERT INTO product (name, price, description)
                 VALUES ('${name}', ${price}, '${description}')`;
    await db.run(query);
    response.send("Product added successfully");
  }
);

// ---------------------------------------------
// View Products (All users)
app.get("/products", authenticate, async (request, response) => {
  const products = await db.all(`SELECT * FROM product`);
  response.send(products);
});

// ---------------------------------------------
// Add to Cart (Customer)
app.post(
  "/cart",
  authenticate,
  authorize("customer"),
  async (request, response) => {
    const { productId, quantity } = request.body;
    const userId = request.user.id;
    const query = `INSERT INTO cart (user_id, product_id, quantity)
                 VALUES (${userId}, ${productId}, ${quantity})`;
    await db.run(query);
    response.send("Item added to cart");
  }
);

// ---------------------------------------------
// Place Order (Customer)
app.post(
  "/orders",
  authenticate,
  authorize("customer"),
  async (request, response) => {
    const userId = request.user.id;
    const cartItems = await db.all(
      `SELECT * FROM cart WHERE user_id = ${userId}`
    );
    if (cartItems.length === 0) {
      response.status(400).send("Cart is empty");
      return;
    }

    const date = new Date().toISOString();
    for (const item of cartItems) {
      const insertOrder = `
      INSERT INTO orders (user_id, product_id, quantity, order_date)
      VALUES (${userId}, ${item.product_id}, ${item.quantity}, '${date}')`;
      await db.run(insertOrder);
    }

    await db.run(`DELETE FROM cart WHERE user_id = ${userId}`);
    response.send("Order placed successfully");
  }
);
