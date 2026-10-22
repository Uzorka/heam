import QRCode from "qrcode";

/** Printable specimen label. The QR encodes only the accession number (no patient details). */
export async function SpecimenLabel({
  accession,
  patient,
  mrn,
  test,
  collectedAt,
}: {
  accession: string;
  patient: string;
  mrn: string;
  test: string;
  collectedAt: string;
}) {
  const svg = await QRCode.toString(accession, { type: "svg", margin: 0, width: 72 });
  return (
    <div className="inline-flex items-center gap-3 rounded-md border border-dashed border-border bg-white p-3 text-black">
      <div className="h-[72px] w-[72px]" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="text-[12px] leading-4">
        <p className="font-mono text-[14px] font-semibold">{accession}</p>
        <p>{patient}</p>
        <p className="font-mono">{mrn}</p>
        <p>{test}</p>
        <p>{collectedAt}</p>
      </div>
    </div>
  );
}
