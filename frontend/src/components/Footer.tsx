

import { Github, Mail, FileText } from "lucide-react";

const Footer = () => {
  return (
    <footer className="w-full py-4 px-4 sm:px-6 bg-gray-50 border-t border-gray-100">
      <div className="max-w-[1400px] mx-auto flex justify-center items-center">
        {/* Links - centered and with light gray color */}
        <div className="flex flex-wrap justify-center gap-x-10 gap-y-4 items-center">
          <a 
            href="https://github.com/cBioPortal/datahub" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-2"
          >
            <Github className="h-4 w-4" />
            DataHub
          </a>
          <a 
            href="https://docs.cbioportal.org/file-formats/" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-2"
          >
            <FileText className="h-4 w-4" />
            File Formats
          </a>
          <a 
            href="mailto:cdsicuration@mskcc.org" 
            className="text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-2"
          >
            <Mail className="h-4 w-4" />
            Contact Us
          </a>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

