SELECT 
    id,
    parent_id,
    name,
    wallet_amount AS main_wallet,
    trading_wallet_amount AS trade_wallet,
    auto_trade
FROM users;

SELECT  
    id,
    parent_id,
    name,
    email,
    wallet_amount AS main_wallet,
    trading_wallet_amount AS trade_wallet,
    auto_trade
FROM users
WHERE id IN (12, 17, 18, 19, 20, 21,3);

DELETE FROM commission_runs;

DELETE FROM notifications
WHERE DATE(created_at) IN ('2026-03-29', '2026-03-30');

