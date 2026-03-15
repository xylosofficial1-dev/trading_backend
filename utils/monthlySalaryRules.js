const rules = [
  { business: 1000, salary: 60 },
  { business: 2500, salary: 135 },
  { business: 5000, salary: 320 },
  { business: 10000, salary: 800 },
  { business: 25000, salary: 2000 },
  { business: 50000, salary: 5000 },
  { business: 100000, salary: 12000 },
  { business: 250000, salary: 26000 },
  { business: 500000, salary: 50000 },
  { business: 1000000, salary: 1000000 }
];

function getSalary(business) {

  let salary = 0;
  let level = 0;

  for (const rule of rules) {
    if (business >= rule.business) {
      salary = rule.salary;
      level = rule.business;
    }
  }

  return { salary, level };

}

module.exports = getSalary;