import PDFDocument from "pdfkit";
import type { SecAuditPlanRecord, AuditComparison } from "../domain/secaudit-plan-store.js";

type PDFOptions = {
  plan: SecAuditPlanRecord;
  comparison?: AuditComparison | null | undefined;
};

export function generateSecAuditPDF(options: PDFOptions): Buffer {
  const { plan, comparison } = options;
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  // Header
  doc.fontSize(24).font("Helvetica-Bold").text("Security Audit Report", { align: "center" });
  doc.fontSize(10).font("Helvetica").text(`Endpoint: ${plan.endpointId} | Tenant: ${plan.tenantId}`, { align: "center" });
  doc.fontSize(9).fillColor("#666").text(`Generated: ${new Date().toLocaleString()}`, { align: "center" });
  doc.moveDown(1.5);

  // Executive Summary Box
  doc.rect(40, doc.y, 515, 120).stroke();
  doc.fontSize(12).font("Helvetica-Bold").text("EXECUTIVE SUMMARY", 50, doc.y + 10);
  doc.moveDown(0.5);

  const score = plan.score ?? 0;
  const scoreColor = score >= 80 ? "#2ecc71" : score >= 60 ? "#f39c12" : "#e74c3c";
  doc.fontSize(28).fillColor(scoreColor).font("Helvetica-Bold").text(`${score}/100`, 50, doc.y);
  doc.fillColor("#000").fontSize(10).font("Helvetica").text("Security Score", 50, doc.y);

  const severities = plan.severityBuckets ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const x = 200;
  doc.fontSize(9).font("Helvetica-Bold");
  doc.text(`Critical: ${severities.critical}`, x, doc.y - 50, { width: 100 });
  doc.text(`High: ${severities.high}`, x, doc.y + 15);
  doc.text(`Medium: ${severities.medium}`, x, doc.y + 15);
  doc.text(`Low: ${severities.low}`, x, doc.y + 15);

  if (comparison && comparison.percentageImprovement !== null && comparison.percentageImprovement !== undefined) {
    const improvementColor = comparison.percentageImprovement > 0 ? "#2ecc71" : "#e74c3c";
    doc.fillColor(improvementColor).fontSize(11).font("Helvetica-Bold");
    doc.text(`${comparison.percentageImprovement > 0 ? "+" : ""}${comparison.percentageImprovement}% vs Baseline`, x + 150, doc.y - 60);
  }

  doc.moveDown(5);

  // Completion Summary
  const completed = plan.results.filter((x) => x.status === "completed").length;
  const failed = plan.results.filter((x) => x.status === "failed").length;
  const pending = plan.results.length - completed - failed;

  doc.fillColor("#000").fontSize(10).font("Helvetica");
  doc.text(`Status: ${plan.status} | Modules: ${completed}/${plan.results.length} completed | Failed: ${failed} | Pending: ${pending}`);
  doc.moveDown(1.5);

  // Findings Table
  doc.fontSize(12).font("Helvetica-Bold").text("FINDINGS BY MODULE");
  doc.moveDown(0.5);

  const tableTop = doc.y;
  const col1 = 50;
  const col2 = 220;
  const col3 = 380;
  const col4 = 480;
  const rowHeight = 25;

  // Header row
  doc.rect(40, tableTop, 515, rowHeight).stroke();
  doc.fontSize(9).font("Helvetica-Bold");
  doc.text("Module", col1, tableTop + 7);
  doc.text("Severity", col2, tableTop + 7);
  doc.text("Status", col3, tableTop + 7);
  doc.text("Findings", col4, tableTop + 7);

  let y = tableTop + rowHeight;
  for (const result of plan.results.slice(0, 15)) {
    const severity = (result.findings as Record<string, unknown>)?.severity ?? "unknown";
    const status = result.status;
    const findingCount = (result.evidence?.length ?? 0).toString();

    doc.rect(40, y, 515, rowHeight).stroke();
    doc.fontSize(8).font("Helvetica");

    const module = result.moduleId.replace(/^[^.]+\./, "");
    doc.text(module, col1, y + 7);

    const sevColor = severity === "critical" ? "#e74c3c" : severity === "high" ? "#e67e22" : "#f39c12";
    doc.fillColor(sevColor).text(String(severity), col2, y + 7);
    doc.fillColor("#000");

    doc.text(status, col3, y + 7);
    doc.text(findingCount, col4, y + 7);

    y += rowHeight;
  }

  doc.moveDown(2);

  // Remediation Checklist
  doc.fontSize(12).font("Helvetica-Bold").text("RECOMMENDED REMEDIATIONS");
  doc.moveDown(0.5);

  const criticalFindings = plan.results.filter((x) => (x.findings as Record<string, unknown>)?.severity === "critical" && x.status === "completed");
  if (criticalFindings.length > 0) {
    doc.fontSize(10).font("Helvetica-Bold").text("Critical Priority:", { underline: true });
    criticalFindings.slice(0, 5).forEach((finding) => {
      const module = finding.moduleId.replace(/^[^.]+\./, "");
      doc.fontSize(9).font("Helvetica").text(`☐ Address ${module} finding`, { indent: 20 });
    });
    doc.moveDown(0.5);
  }

  const highFindings = plan.results.filter((x) => (x.findings as Record<string, unknown>)?.severity === "high" && x.status === "completed");
  if (highFindings.length > 0) {
    doc.fontSize(10).font("Helvetica-Bold").text("High Priority:", { underline: true });
    highFindings.slice(0, 5).forEach((finding) => {
      const module = finding.moduleId.replace(/^[^.]+\./, "");
      doc.fontSize(9).font("Helvetica").text(`☐ Review ${module} configuration`, { indent: 20 });
    });
  }

  doc.moveDown(1.5);

  // Footer
  doc.fontSize(8).fillColor("#999").text("This report contains sensitive security information. Handle with care.", { align: "center" });
  doc.text(`Plan ID: ${plan.id}`, { align: "center" });

  doc.end();

  return Buffer.concat(chunks);
}
