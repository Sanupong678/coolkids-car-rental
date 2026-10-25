// Imported first by every test file: point config at the throwaway test DB.
process.env.NODE_ENV = "test";
process.env.DB_NAME = process.env.TEST_DB_NAME || "car_rental_test";
process.env.BOOTSTRAP_SUPER_ADMINS = "boss@example.com";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.APP_URL = "http://localhost:5000";
