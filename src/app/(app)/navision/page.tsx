// What: a look inside "our form of Navision": the JSON files in data/navision and what the app has written to export/.
// Who calls it: the "Mock Navision" link in the sidebar. Useful in a demo to show exactly what was exported.
// To extend: this page only works with FileNavisionGateway. With a real Navision you would look in Navision itself.
import { PageHeader } from "@/components/PageHeader";
import { FileNavisionGateway } from "@/adapters/navision/fileGateway";
import { displayMoney } from "@/domain/money";
import { formatDate } from "@/domain/time";
import { getDeps } from "@/services/deps";

export default async function NavisionPage() {
  const deps = await getDeps();
  if (!(deps.navision instanceof FileNavisionGateway)) {
    return (
      <>
        <PageHeader title="Mock Navision" />
        <div className="notice notice-info">This page only shows the file-based stand-in. The app is connected to a different Navision gateway.</div>
      </>
    );
  }
  const data = await deps.navision.listEverything();
  const exported = await deps.navision.listExportFiles();
  const purchaseOrders = await deps.navision.listPurchaseOrders();
  const openOrders = await deps.navision.listOpenOrders();
  const directory = await deps.navision.getStaffDirectory();

  return (
    <>
      <PageHeader
        title="Mock Navision"
        subtitle={`Plain JSON files in ${deps.config.navisionDir}. They are read on every request, so editing a file changes the app at once. Synthetic data only.`}
      />

      <div className="card">
        <h2>Export folder: what the app has written for Navision ({exported.length})</h2>
        {exported.length === 0 ? (
          <p className="muted">Nothing has been exported yet. A file appears here only after a person approves a preview.</p>
        ) : (
          exported.map((file) => (
            <details key={file.path} style={{ marginBottom: 8 }}>
              <summary className="mono">{file.path}</summary>
              <pre className="file-preview">{file.text}</pre>
            </details>
          ))
        )}
      </div>

      <div className="card card-tight">
        <div className="card-title">Items ({data.items.length})</div>
        <table className="table">
          <thead>
            <tr>
              <th>Item no.</th>
              <th>Description</th>
              <th>Vendor</th>
              <th className="right">Sales price</th>
              <th className="right">Purchase price</th>
              <th className="right">Stock</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.itemNo}>
                <td className="mono">{item.itemNo}</td>
                <td>{item.description}</td>
                <td>{data.vendors.find((vendor) => vendor.vendorId === item.vendorId)?.name ?? item.vendorId}</td>
                <td className="right">
                  {item.currency} {displayMoney(item.price)}
                </td>
                <td className="right">
                  {item.currency} {displayMoney(item.purchasePrice)}
                </td>
                <td className="right">{item.stockQty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2">
        <div className="card card-tight">
          <div className="card-title">Customers ({data.customers.length})</div>
          <table className="table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Name</th>
                <th>Country</th>
                <th>Terms</th>
              </tr>
            </thead>
            <tbody>
              {data.customers.map((customer) => (
                <tr key={customer.customerNo}>
                  <td className="mono">{customer.customerNo}</td>
                  <td>{customer.name}</td>
                  <td>{customer.country}</td>
                  <td>{customer.paymentTerms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card card-tight">
          <div className="card-title">Staff and approval hierarchy</div>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {directory.staff.map((member) => (
                <tr key={member.id}>
                  <td>{member.name}</td>
                  <td>{member.role}</td>
                  <td className="muted">
                    {member.id === directory.approverId ? "Approves SPRs. " : ""}
                    {member.id === directory.standInId ? "Stand-in approver. " : ""}
                    {directory.plannedLeave
                      .filter((leave) => leave.staffId === member.id)
                      .map((leave) => `Planned leave ${formatDate(leave.from)} to ${formatDate(leave.to)}.`)
                      .join(" ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-tight">
          <div className="card-title">Purchase orders ({purchaseOrders.length})</div>
          <table className="table">
            <thead>
              <tr>
                <th>PO</th>
                <th>Vendor</th>
                <th className="right">Amount</th>
                <th>Payment due</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrders.map((order) => (
                <tr key={order.poNumber}>
                  <td className="mono">{order.poNumber}</td>
                  <td>{order.vendorName}</td>
                  <td className="right">
                    {order.currency} {displayMoney(order.totalAmount)}
                  </td>
                  <td>{formatDate(order.paymentDueDate)}</td>
                  <td>{order.paid ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card card-tight">
          <div className="card-title">Goods receipts ({data.goodsReceipts.length})</div>
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>PO</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {data.goodsReceipts.map((receipt) => (
                <tr key={receipt.grNo}>
                  <td className="mono">{receipt.grNo}</td>
                  <td className="mono">{receipt.poNumber}</td>
                  <td>{receipt.lines.map((line) => `${line.receivedQty} x ${line.itemNo}`).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-tight">
        <div className="card-title">Open customer orders already in Navision ({openOrders.length})</div>
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Customer PO</th>
              <th>Promised ship date</th>
              <th>Lines</th>
            </tr>
          </thead>
          <tbody>
            {openOrders.map((order) => (
              <tr key={order.orderNo}>
                <td className="mono">{order.orderNo}</td>
                <td>{order.customerName}</td>
                <td className="mono">{order.poNumber}</td>
                <td>{formatDate(order.promisedShipDate)}</td>
                <td>{order.lines.map((line) => `${line.quantity} x ${line.itemNo}`).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
