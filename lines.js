// Maps each demo phone number (E.164) to its trade knowledge base and business name.
// Swap numbers here when the Twilio lines move to Telnyx; nothing else changes.
module.exports = {
  "+17026028867": { trade: "plumbing",   business: "Copperline Plumbing",     carrier: "telnyx" },
  "+17027448394": { trade: "hvac",       business: "Blue Mesa Heating & Air", carrier: "twilio (temporary)" },
  "+17253537160": { trade: "roofing",    business: "Ironridge Roofing",       carrier: "twilio (temporary)" },
  "+17253072525": { trade: "electrical", business: "Brightwire Electric",     carrier: "twilio (temporary)" }
};
