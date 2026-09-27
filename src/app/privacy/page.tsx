import LegalPage, { legalMetadata } from "@/components/LegalPage";

export const generateMetadata = () => legalMetadata("privacy");

export default function Page() {
  return <LegalPage doc="privacy" />;
}
