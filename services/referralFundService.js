const pool = require("../db/db");

const FUND_RULES = [
{
 deposit:100,
 rewards:[
 {refs:10,reward:75},
 {refs:35,reward:275},
 {refs:85,reward:755},
 {refs:185,reward:1755}
 ]
},
{
 deposit:350,
 rewards:[
 {refs:10,reward:300},
 {refs:35,reward:1000},
 {refs:85,reward:2700},
 {refs:185,reward:6500}
 ]
},
{
 deposit:850,
 rewards:[
 {refs:10,reward:700},
 {refs:35,reward:2200},
 {refs:85,reward:5200},
 {refs:185,reward:12200}
 ]
},
{
 deposit:1850,
 rewards:[
 {refs:10,reward:1200},
 {refs:35,reward:4200},
 {refs:85,reward:11200},
 {refs:185,reward:23200}
 ]
}
];

async function checkReferralFundReward(userId){

// find parent
const parentRes = await pool.query(
`SELECT parent_id FROM users WHERE id=$1`,
[userId]
);

const parentId = parentRes.rows[0]?.parent_id;

if(!parentId) return;


// count qualified referrals
for(const fund of FUND_RULES){

const refs = await pool.query(
`
SELECT COUNT(*)
FROM users
WHERE parent_id=$1
AND trading_wallet_amount >= $2
`,
[parentId,fund.deposit]
);

const count = Number(refs.rows[0].count);


for(const rule of fund.rewards){

if(count >= rule.refs){

// check if reward already given
const exist = await pool.query(
`
SELECT id
FROM referral_fund_rewards
WHERE parent_id=$1
AND fund_level=$2
AND referral_target=$3
`,
[parentId,fund.deposit,rule.refs]
);

if(exist.rows.length === 0){

// credit wallet
await pool.query(
`
UPDATE users
SET wallet_amount = wallet_amount + $1
WHERE id=$2
`,
[rule.reward,parentId]
);


// save history
await pool.query(
`
INSERT INTO referral_fund_rewards
(parent_id,fund_level,referral_target,reward_amount)
VALUES($1,$2,$3,$4)
`,
[parentId,fund.deposit,rule.refs,rule.reward]
);

}
}

}

}

}

module.exports = {checkReferralFundReward};