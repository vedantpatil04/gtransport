-- Separate database for automated tests, so `npm run test:e2e` never touches development data.
CREATE DATABASE gangamata_test OWNER gangamata;
