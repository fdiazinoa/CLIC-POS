// UI-only fixture. Never connects to ERP or applies operations.
import React from "react";
import { createRoot } from "react-dom/client";
import RecoveryCloseDialog from "../../components/RecoveryCloseDialog";
import "../../index.css";
let jobs: any[] = [],
  attempts = 0;
const controller: any = {
  availability: async () => {},
  list: async () => jobs,
  review: async () => {
    jobs = [
      {
        preparationId: "fixture",
        receiptBindings: [{ group: "members" }, { group: "members" }],
        candidate: {
          observed: {
            packetJson: JSON.stringify({
              summary: { total_sales: 150 },
              report: {
                baseCurrency: "DOP",
                cashExpected: { DOP: 100, USD: 1 },
              },
              financialState: "PENDING",
            }),
          },
        },
      },
    ];
  },
  resumeReview: async () => {},
  confirm: async () => {
    attempts++;
    if (attempts === 1) {
      jobs[0].ack = { status: "COMMITTED" };
      throw Error("SQLITE_TEST_FAULT");
    }
    jobs[0].published = true;
  },
};
createRoot(document.getElementById("root")!).render(
  <RecoveryCloseDialog
    controller={controller}
    input={{
      terminalId: "T1",
      user: { id: "qa", name: "QA" },
      notes: "fixture",
      declaration: {},
    }}
    onClose={() => {}}
    onPublished={() => {
      document.body.textContent = "POS actualizado";
    }}
  />,
);
