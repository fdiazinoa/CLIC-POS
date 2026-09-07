import type {
  BusinessConfig,
  Transaction,
  CashMovement,
  Collection,
  TerminalConfig,
  User,
} from "../../types";
import { calculateZReportStats } from "../../utils/analytics";
import { buildServiceTypeReport } from "../../utils/orderServiceType";
import {
  ALL_CLOSE_REPORT_SECTIONS,
  buildCloseReportDetails,
  resolveCloseReportSections,
} from "../../utils/closeReportOptions";
import { buildCloseTaxSummary } from "../../utils/closeReceiptSummary";
import { buildZReportPaymentMethodSummary } from "../../utils/zReportPaymentSummary";

export interface NativeZReportInput {
  terminalTransactions: Transaction[];
  terminalCashMovements: CashMovement[];
  terminalCollections: Collection[];
  terminalId: string;
  config: BusinessConfig;
  currentTerminal?: { config?: TerminalConfig };
  currentUser?: Pick<User, "id" | "name"> | null;
  reportData?: any;
  notes: string;
  fallbackOpenedAt: string;
}
/** Shared native content producer. No IDs/numbers allocated, persistence, network or printing.
 * Inputs are already selected; this does not prove selection completeness or cash-session identity.
 */
export function buildNativeZReportContent(input: NativeZReportInput) {
  const {
    terminalTransactions,
    terminalCashMovements,
    terminalCollections,
    terminalId,
    config,
    currentTerminal,
    currentUser,
    reportData,
    notes,
    fallbackOpenedAt,
  } = input;
  // 3. Totals and Stats from the exact transaction set being archived.
  const paymentMethodSummary = buildZReportPaymentMethodSummary(
    terminalTransactions,
    config,
  );
  const totalsByMethod = paymentMethodSummary.reduce(
    (acc: Record<string, number>, line) => {
      acc[line.methodType] =
        (acc[line.methodType] || 0) + Number(line.amount || 0);
      return acc;
    },
    {},
  );

  const stats = calculateZReportStats(
    terminalTransactions,
    terminalCollections,
  );
  const serviceTypeReport = buildServiceTypeReport(terminalTransactions);
  const transactionCount = terminalTransactions.length;
  const declaredCashByCurrency = (reportData?.cashCountedByCurrency ||
    {}) as Record<string, unknown>;
  const expectedCashByCurrencySnapshot = (reportData?.expectedCashByCurrency ||
    {}) as Record<string, unknown>;

  const cashDeclaredTotal: number = Object.values(
    declaredCashByCurrency,
  ).reduce<number>((sum, value) => {
    const parsed = Number(value);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
  const expectedCashTotal: number = Object.values(
    expectedCashByCurrencySnapshot,
  ).reduce<number>((sum, value) => {
    const parsed = Number(value);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
  const declaredCardTotal: number = Number(reportData?.declaredCardTotal) || 0;
  const declaredOtherTotal: number =
    Number(reportData?.declaredOtherTotal) || 0;
  const expectedCardTotal: number = Number(reportData?.expectedCardTotal) || 0;
  const expectedOtherTotal: number =
    Number(reportData?.expectedOtherTotal) || 0;
  const orderedTicketRefs = terminalTransactions
    .map((transaction) => transaction.displayId || transaction.id)
    .filter(Boolean);
  const cashMovementDetails = terminalCashMovements.map((movement) => ({
    id: movement.id,
    type: movement.type,
    amount: Number(movement.amount || 0),
    reason: movement.reason || "Movimiento General",
    timestamp: movement.timestamp,
    userName: movement.userName,
    currencyCode: movement.currencyCode,
  }));
  const firstTicketId = orderedTicketRefs[0] || null;
  const lastTicketId = orderedTicketRefs[orderedTicketRefs.length - 1] || null;
  const openedAtCandidates = [
    ...terminalTransactions.map((t) => new Date(t.date).getTime()),
    ...terminalCashMovements.map((m) => new Date(m.timestamp).getTime()),
  ].filter((value) => Number.isFinite(value)) as number[];
  const openedAt =
    openedAtCandidates.length > 0
      ? new Date(Math.min(...openedAtCandidates)).toISOString()
      : fallbackOpenedAt;

  const enabledSections = resolveCloseReportSections(
    config,
    terminalId,
    currentUser?.id,
    "Z",
  );
  // Store every annex once. Printing still honors enabledSections, while a
  // later reprint can safely apply options enabled after this closure.
  const reportDetails = buildCloseReportDetails(
    terminalTransactions,
    config,
    currentTerminal?.config,
    ALL_CLOSE_REPORT_SECTIONS,
  );
  return {
    terminalId,
    source_terminal_id: terminalId,
    openedAt,
    closedByUserId: currentUser?.id || "sys",
    closedByUserName: currentUser?.name || "System",
    baseCurrency:
      (config.currencies || []).find((c) => c.isBase)?.code ||
      (config.currencies || [])[0]?.code ||
      "DOP",
    totalsByMethod,
    paymentMethodSummary,
    paymentMethodDeclarations: reportData?.paymentMethodDeclarations || [],
    cashExpected: reportData?.expectedCashByCurrency || {},
    cashCounted: reportData?.cashCountedByCurrency || {},
    cashDiscrepancy: reportData?.cashDiscrepancyByCurrency || {},
    denominationBreakdown: reportData?.denominationBreakdown,
    denomination_breakdown: reportData?.denominationBreakdown,
    cashSales: reportData?.cashSalesTotal || 0,
    cashIn: reportData?.cashIn || 0,
    cashOut: reportData?.cashOut || 0,
    cashMovementDetails,
    requireCashFundOnZ: Boolean(reportData?.requireCashFundOnZ),
    fixedCashFundAmount: Number(reportData?.fixedCashFundAmount || 0),
    cashToLeaveInDrawer: Number(reportData?.cashToLeaveInDrawer || 0),
    cashToWithdraw: Number(reportData?.cashToWithdraw || 0),
    transactionCount,
    notes,
    declared_totals: {
      cash: cashDeclaredTotal,
      card: declaredCardTotal,
      other: declaredOtherTotal,
      total_declared:
        cashDeclaredTotal + declaredCardTotal + declaredOtherTotal,
    },
    system_totals: {
      expected_cash: expectedCashTotal,
      expected_card: expectedCardTotal,
      expected_other: expectedOtherTotal,
      total_expected:
        expectedCashTotal + expectedCardTotal + expectedOtherTotal,
      cash_difference: cashDeclaredTotal - expectedCashTotal,
      total_difference:
        cashDeclaredTotal +
        declaredCardTotal +
        declaredOtherTotal -
        (expectedCashTotal + expectedCardTotal + expectedOtherTotal),
    },
    sync_audit: {
      total_tickets_issued: transactionCount,
      first_ticket_id: firstTicketId,
      last_ticket_id: lastTicketId,
    },
    stats,
    serviceTypeSummary: serviceTypeReport.summary,
    closeTaxSummary: buildCloseTaxSummary(terminalTransactions),
    serviceTypeTransactions: serviceTypeReport.transactions,
    enabledSections,
    reportDetails,
  };
}
