
import { jsPDF } from "jspdf";

export const generatePDF = (title: string, text: string, imageDataUrl: string) => {
    try {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 10;
        const maxLineWidth = pageWidth - (margin * 2);

        // Add Title
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.text(title, margin, margin + 5);

        // Add Image (Fit to width, keep aspect ratio roughly)
        // We assume strictly vertical layout for simplicity
        const imgProps = doc.getImageProperties(imageDataUrl);
        const imgHeight = (imgProps.height * maxLineWidth) / imgProps.width;
        
        // Check if image is too tall for one page with title
        let currentY = margin + 15;
        
        if (imgHeight < (pageHeight - 40)) {
            doc.addImage(imageDataUrl, 'JPEG', margin, currentY, maxLineWidth, imgHeight);
            currentY += imgHeight + 10;
        } else {
            // Add image on new page if huge
            doc.addPage();
            doc.addImage(imageDataUrl, 'JPEG', margin, margin, maxLineWidth, imgHeight);
            currentY = margin + imgHeight + 10; // This might push off page, simplistic handling
        }

        // Add Extracted Text
        doc.setFontSize(12);
        doc.setFont("helvetica", "normal");
        
        // Add a header for the text
        if (currentY > pageHeight - 30) {
            doc.addPage();
            currentY = margin;
        }
        
        doc.setFont("helvetica", "italic");
        doc.text("OCR Extracted Text:", margin, currentY);
        currentY += 7;
        doc.setFont("helvetica", "normal");

        const splitText = doc.splitTextToSize(text, maxLineWidth);
        
        // Basic pagination for text
        for (let i = 0; i < splitText.length; i++) {
            if (currentY > pageHeight - 15) {
                doc.addPage();
                currentY = margin;
            }
            doc.text(splitText[i], margin, currentY);
            currentY += 6; // Line height
        }

        doc.save(`${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
    } catch (error) {
        console.error("Error generating PDF", error);
        alert("Could not generate PDF. Please try again.");
    }
};
