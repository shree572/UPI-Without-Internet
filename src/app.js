const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

// Import database and models
const models = require('./models');

// Import crypto services
const ServerKeyHolder = require('./crypto/ServerKeyHolder');
const HybridCryptoService = require('./crypto/HybridCryptoService');

// Import services
const DemoService = require('./services/DemoService');
const MeshSimulatorService = require('./services/MeshSimulatorService');
const IdempotencyService = require('./services/IdempotencyService');
const SettlementService = require('./services/SettlementService');
const BridgeIngestionService = require('./services/BridgeIngestionService');

// Import routes
const apiRoutes = require('./routes/api');
const dashboardRoutes = require('./routes/dashboard');

/**
 * Main Express application - Node.js equivalent of Spring Boot UpiMeshApplication
 */
class UpiMeshApplication {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 8080;
    this.services = {};
  }

  async initialize() {
    // Middleware
    this.app.use(cors());
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));
    
    // Static files and views
    this.app.use(express.static(path.join(__dirname, '../views')));
    this.app.use(express.static(path.join(__dirname, '../public')));

    // Initialize database
    await this.initializeDatabase();

    // Initialize services
    await this.initializeServices();

    // Make services available to routes
    this.app.locals.services = this.services;

    // Routes
    this.app.use('/', dashboardRoutes);
    this.app.use('/api', apiRoutes);

    // Global error handler
    this.app.use((err, req, res, next) => {
        console.error("GLOBAL ERROR:", err);
        res.status(500).json({ error: err.message });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  async initializeDatabase() {
    try {
      await models.sequelize.authenticate();
      console.log('Database connection established successfully.');
      
      // Sync all models
      await models.sequelize.sync({ force: false });
      console.log('Database synchronized successfully.');
    } catch (error) {
      console.error('Unable to connect to database:', error);
      throw error;
    }
  }

  async initializeServices() {
    try {
      // Initialize crypto services
      const serverKeyHolder = new ServerKeyHolder();
      await serverKeyHolder.init();
      
      const cryptoService = new HybridCryptoService(serverKeyHolder);
      
      // Initialize repositories (from models)
      const accountRepository = models.Account;
      const transactionRepository = models.Transaction;
      
      // Initialize application services
      const demoService = new DemoService(accountRepository, cryptoService, serverKeyHolder);
      const meshSimulator = new MeshSimulatorService();
      const idempotencyService = new IdempotencyService(86400); // 24 hours
      const settlementService = new SettlementService(accountRepository, transactionRepository);
      const bridgeIngestionService = new BridgeIngestionService(
        cryptoService, 
        idempotencyService, 
        settlementService,
        86400 // 24 hours max age
      );
      
      // Seed demo accounts
      await demoService.seedAccounts();
      
      // Store services for injection
      this.services = {
        serverKeyHolder,
        cryptoService,
        accountRepository,
        transactionRepository,
        demoService,
        meshSimulator,
        idempotencyService,
        settlementService,
        bridgeIngestionService
      };
      
      console.log('All services initialized successfully.');
    } catch (error) {
      console.error('Failed to initialize services:', error);
      throw error;
    }
  }

  async start() {
    try {
      await this.initialize();
      
      this.app.listen(this.port, () => {
        console.log(`UPI Offline Mesh Demo started successfully!`);
        console.log(`Dashboard available at: http://localhost:${this.port}`);
        console.log(`API endpoints at: http://localhost:${this.port}/api`);
        console.log('Press Ctrl+C to stop the server.');
      });
    } catch (error) {
      console.error('Failed to start application:', error);
      process.exit(1);
    }
  }

  async stop() {
    console.log('Shutting down gracefully...');
    
    // Cleanup services
    if (this.services.idempotencyService) {
      this.services.idempotencyService.destroy();
    }
    
    // Close database connection
    if (models && models.sequelize) {
      await models.sequelize.close();
    }
    
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT. Graceful shutdown...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM. Graceful shutdown...');
  process.exit(0);
});

// Start the application
const app = new UpiMeshApplication();
app.start().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

module.exports = UpiMeshApplication;
