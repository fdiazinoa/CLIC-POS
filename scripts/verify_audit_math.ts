
function calculateNewAvgCost(currentBalance: number, currentAvgCost: number, qtyIn: number, unitCost: number) {
    const prevBalance = currentBalance - qtyIn;
    const inCost = unitCost;

    if (prevBalance <= 0) {
        return inCost;
    } else {
        const prevValue = prevBalance * currentAvgCost;
        const newValue = qtyIn * inCost;
        return (prevValue + newValue) / currentBalance;
    }
}

console.log("--- INVENTORY MATH VERIFICATION ---");

console.log("\nSCENARIO 1: The user's case (Negative stock leveled by audit)");
// -6 System, 20 Physical -> +26 adjustment
// Product cost is $90. My fix ensures audit uses $90 if possible.
let initialBalance = -6;
let initialCost = 90;
let intakeQty = 26;
let intakeCost = 90; // Fixed by recordInventoryMovement
let finalBalance = initialBalance + intakeQty;
let finalCost = calculateNewAvgCost(finalBalance, initialCost, intakeQty, intakeCost);
console.log(`Original: ${initialBalance} @ $${initialCost}`);
console.log(`Intake:   +${intakeQty} @ $${intakeCost}`);
console.log(`Result:   ${finalBalance} @ $${finalCost}`);
if (finalCost === 90) console.log("✅ SUCCESS: Cost reset to intake cost because previous balance was negative.");

console.log("\nSCENARIO 2: Negative stock leveled by audit @ $0 (Historical case fix)");
// Even if the intake cost is $0 (old sessions), we still want to avoid negative average cost.
intakeCost = 0;
finalCost = calculateNewAvgCost(finalBalance, initialCost, intakeQty, intakeCost);
console.log(`Original: ${initialBalance} @ $${initialCost}`);
console.log(`Intake:   +${intakeQty} @ $${intakeCost}`);
console.log(`Result:   ${finalBalance} @ $${finalCost}`);
if (finalCost >= 0) console.log("✅ SUCCESS: Cost is $0, not negative.");

console.log("\nSCENARIO 3: Standard WAC (Positive stock)");
initialBalance = 10;
initialCost = 90;
intakeQty = 10;
intakeCost = 110;
finalBalance = initialBalance + intakeQty;
finalCost = calculateNewAvgCost(finalBalance, initialCost, intakeQty, intakeCost);
console.log(`Original: ${initialBalance} @ $${initialCost}`);
console.log(`Intake:   +${intakeQty} @ $${intakeCost}`);
console.log(`Result:   ${finalBalance} @ $${finalCost}`);
if (finalCost === 100) console.log("✅ SUCCESS: Standard WAC calculated correctly: (10*90 + 10*110)/20 = 100");

console.log("\n--- VERIFICATION COMPLETE ---");
