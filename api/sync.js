
export default function handler(req, res) {
  // Legacy API route. 
  // App now uses Firebase Client SDK directly.
  res.status(200).json({ status: "Migrated to Firebase" });
}
