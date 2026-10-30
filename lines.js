// Compatibility view of the customer store (customers/*.json), keyed by phone number
// in the old lines.js shape. New code should use customers.js directly.
const { createStore } = require("./customers");
module.exports = Object.fromEntries(createStore({ log: { error() {} } }).all().map(c =>
  [c.phoneNumber, { id: c.id, trade: c.trade, business: c.business, carrier: c.carrier, ownerEmail: c.ownerEmail || undefined, demo: c.demo }]));
