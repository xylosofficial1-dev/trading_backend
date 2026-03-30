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
    wallet_amount AS main_wallet,
    trading_wallet_amount AS trade_wallet,
    auto_trade
FROM users
WHERE id IN (12, 17, 18, 19, 20, 21);