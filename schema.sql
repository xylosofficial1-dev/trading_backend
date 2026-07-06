-- Create Enum Types
CREATE TYPE user_status AS ENUM ('ok', 'block');
CREATE TYPE withdrawal_status AS ENUM ('pending', 'completed', 'rejected');

-- Create Tables

-- 1. users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  phone VARCHAR(20) UNIQUE,
  email VARCHAR(100) UNIQUE,
  password_hash TEXT,
  dob DATE,
  gender VARCHAR(10),
  country_code VARCHAR(10),
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  mpin_hash TEXT,
  last_added_amount NUMERIC DEFAULT 0,
  profile_image BYTEA,
  wallet_address VARCHAR(100) UNIQUE,
  wallet_amount NUMERIC(12,2) DEFAULT 0,
  trading_wallet_amount NUMERIC(12,2) DEFAULT 0,
  tw_to_mw BOOLEAN DEFAULT FALSE,
  status user_status NOT NULL DEFAULT 'ok',
  notifications_seen_at TIMESTAMP,
  referral_code VARCHAR(20) UNIQUE,
  parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  auto_trade BOOLEAN DEFAULT FALSE,
  commission_start_at TIMESTAMP,
  next_commission_at TIMESTAMP,
  is_online BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMP,
  kyc_verify BOOLEAN DEFAULT FALSE,
  commission_enabled BOOLEAN DEFAULT TRUE,
  expo_push_token TEXT,
  withdraw_req_count INT DEFAULT 0,
  withdraw_req_started_at TIMESTAMP DEFAULT NOW(),
  withdraw_req_completed BOOLEAN DEFAULT TRUE,
  transfer_blocked BOOLEAN DEFAULT FALSE
);

-- 2. withdrawal_otp
CREATE TABLE withdrawal_otp (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp VARCHAR(10) NOT NULL,
  verified BOOLEAN DEFAULT false,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. kyc_requests
CREATE TABLE kyc_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gov_id_image BYTEA NOT NULL,
  face_image BYTEA NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. commission_history
CREATE TABLE commission_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commission_percent NUMERIC(10,2) NOT NULL,
  commission_amount NUMERIC(18,2) NOT NULL,
  wallet_type VARCHAR(20) NOT NULL CHECK (wallet_type IN ('trading_wallet', 'main_wallet')),
  before_balance NUMERIC(18,2) NOT NULL,
  after_balance NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  commission_source VARCHAR(20) DEFAULT 'self'
);

-- 5. monthly_salary_status
CREATE TABLE monthly_salary_status (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_business_level NUMERIC(18,2) NOT NULL DEFAULT 0,
  current_salary NUMERIC(18,2) NOT NULL DEFAULT 0,
  level_started_at TIMESTAMP,
  next_claim_at TIMESTAMP
);

-- 6. wallet_transfers
CREATE TABLE wallet_transfers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  transfer_type VARCHAR(50) NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 7. wallet_transfer_history
CREATE TABLE wallet_transfer_history (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  sender_wallet VARCHAR(255),
  receiver_wallet VARCHAR(255),
  amount NUMERIC(18,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 8. coins
CREATE TABLE coins (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) UNIQUE,
  name VARCHAR(50),
  price_usd NUMERIC(12,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. user_coin_balances
CREATE TABLE user_coin_balances (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  coin_symbol VARCHAR(10),
  quantity NUMERIC(18,8) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, coin_symbol)
);

-- 10. referral_fund_rewards
CREATE TABLE referral_fund_rewards (
  id SERIAL PRIMARY KEY,
  parent_id INTEGER,
  fund_level INTEGER,
  referral_target INTEGER,
  reward_amount NUMERIC,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 11. swap_history
CREATE TABLE swap_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  coin_symbol VARCHAR(10),
  type VARCHAR(10),
  quantity NUMERIC(18,8),
  price_usd NUMERIC(18,8),
  total_usd NUMERIC(18,8),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. trade_commission_cycles
CREATE TABLE trade_commission_cycles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMP NOT NULL,
  last_paid_at TIMESTAMP
);

-- 13. video_topics
CREATE TABLE video_topics (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 14. referral_task_rewards
CREATE TABLE referral_task_rewards (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  deposit_required NUMERIC,
  referral_required INTEGER,
  reward_amount NUMERIC,
  created_at TIMESTAMP DEFAULT NOW(),
  claimed BOOLEAN DEFAULT FALSE
);

-- 15. monthly_salary_claims
CREATE TABLE monthly_salary_claims (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  salary_amount NUMERIC,
  business_level NUMERIC,
  claimed_at TIMESTAMP DEFAULT NOW()
);

-- 16. videos
CREATE TABLE videos (
  id SERIAL PRIMARY KEY,
  topic_id INTEGER REFERENCES video_topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT CHECK (type IN ('youtube', 'file')),
  link TEXT,
  video_data BYTEA,
  created_at TIMESTAMP DEFAULT NOW(),
  thumbnail BYTEA
);

-- 17. pay_options
CREATE TABLE pay_options (
  id INTEGER PRIMARY KEY DEFAULT 1,
  coin_name VARCHAR(50),
  wallet_address TEXT,
  qr_image BYTEA
);

-- 18. p2p_sell_listings
CREATE TABLE p2p_sell_listings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  coin_name VARCHAR(20) DEFAULT 'USDT',
  price NUMERIC(18,8),
  quantity NUMERIC(18,8),
  description TEXT,
  payment_method VARCHAR(20),
  bank_details TEXT,
  upi_id TEXT,
  qr_image BYTEA,
  wallet_address TEXT,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 19. p2p_penalty_settings
CREATE TABLE p2p_penalty_settings (
  id SERIAL PRIMARY KEY,
  penalty_amount NUMERIC NOT NULL
);

-- 20. p2p_buy_requests
CREATE TABLE p2p_buy_requests (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER REFERENCES p2p_sell_listings(id),
  buyer_id INTEGER REFERENCES users(id),
  seller_id INTEGER REFERENCES users(id),
  coin_name VARCHAR(20),
  price NUMERIC,
  quantity NUMERIC,
  total NUMERIC,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  accepted_at TIMESTAMP,
  expires_at TIMESTAMP
);

-- 21. p2p_payments
CREATE TABLE p2p_payments (
  id SERIAL PRIMARY KEY,
  request_id INTEGER REFERENCES p2p_buy_requests(id),
  screenshot BYTEA,
  tx_id TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 22. admin_settings
CREATE TABLE admin_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  tw_to_mw_deduction_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  CHECK (id = 1)
);

-- 23. p2p_trade_history
CREATE TABLE p2p_trade_history (
  id SERIAL PRIMARY KEY,
  buyer_id INT,
  seller_id INT,
  listing_id INT,
  quantity NUMERIC,
  price NUMERIC,
  total NUMERIC,
  completed_at TIMESTAMP DEFAULT NOW()
);

-- 24. trading_wallet_withdrawals
CREATE TABLE trading_wallet_withdrawals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_amount NUMERIC(12,2) NOT NULL,
  requested_amount NUMERIC(12,2) NOT NULL,
  sent_amount NUMERIC(12,2),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 25. notifications
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('all', 'custom')),
  target_users TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  main_wallet_balance NUMERIC,
  trading_wallet_balance NUMERIC
);

-- 26. system_settings
CREATE TABLE system_settings (
  id SERIAL PRIMARY KEY,
  maintenance BOOLEAN DEFAULT FALSE,
  transfer_enabled BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert Default System Settings
INSERT INTO system_settings (maintenance) VALUES (FALSE);

-- 27. commission_runs
CREATE TABLE commission_runs (
  id SERIAL PRIMARY KEY,
  last_run TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 28. otp_verifications
CREATE TABLE otp_verifications (
  id SERIAL PRIMARY KEY,
  email VARCHAR(100),
  otp VARCHAR(6),
  expires_at TIMESTAMP,
  verified BOOLEAN DEFAULT false
);

-- 29. password_resets
CREATE TABLE password_resets (
  id SERIAL PRIMARY KEY,
  email VARCHAR(100),
  code VARCHAR(6),
  expires_at TIMESTAMP,
  verified BOOLEAN DEFAULT false
);

-- 30. trades
CREATE TABLE trades (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  name VARCHAR(100),
  email VARCHAR(150),
  coin VARCHAR(20),
  trade_type VARCHAR(10),
  price NUMERIC(18,8),
  quantity NUMERIC(18,8),
  total NUMERIC(18,8),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'open',
  profit_loss NUMERIC(18,8) DEFAULT 0,
  closed_at TIMESTAMP,
  profit_amount NUMERIC(12,2),
  result_type VARCHAR(10)
);

-- 31. payment_requests
CREATE TABLE payment_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tx_hash VARCHAR(255) NOT NULL UNIQUE,
  amount_usd NUMERIC(12,2) NOT NULL,
  screenshot BYTEA NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 32. market_custom_rates
CREATE TABLE market_custom_rates (
  symbol TEXT PRIMARY KEY,
  rate NUMERIC DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 33. admin_coins
CREATE TABLE admin_coins (
  id SERIAL PRIMARY KEY,
  name TEXT,
  symbol TEXT,
  rate NUMERIC,
  quantity NUMERIC,
  created_at TIMESTAMP DEFAULT NOW(),
  total_value NUMERIC DEFAULT 0
);

-- 34. support_requests
CREATE TABLE support_requests (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  phone VARCHAR(20),
  email VARCHAR(100),
  group_name VARCHAR(100),
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 35. withdrawal_requests
CREATE TABLE withdrawal_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(100) NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL,
  status withdrawal_status DEFAULT 'pending',
  reject_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 36. market_coins
CREATE TABLE market_coins (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true
);

-- 37. premium_subscriptions
CREATE TABLE premium_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_premium BOOLEAN DEFAULT FALSE,
  auto_renew BOOLEAN DEFAULT TRUE,
  badge_enabled BOOLEAN DEFAULT FALSE,
  subscribed_at TIMESTAMP,
  expires_at TIMESTAMP,
  last_payment_amount NUMERIC(10,2) DEFAULT 0,
  last_payment_date TIMESTAMP,
  next_billing_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 38. premium_faqs
CREATE TABLE premium_faqs (
  id SERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 39. premium_banner
CREATE TABLE premium_banner (
  id SERIAL PRIMARY KEY,
  image BYTEA NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 40. subscription_process_log
CREATE TABLE subscription_process_log (
  id SERIAL PRIMARY KEY,
  last_run_at TIMESTAMP
);

INSERT INTO subscription_process_log (last_run_at) VALUES (NULL);

-- 41. subscription_process_control
CREATE TABLE subscription_process_control (
  id INT PRIMARY KEY,
  last_run TIMESTAMP
);

INSERT INTO subscription_process_control(id, last_run) VALUES (1, NULL);
