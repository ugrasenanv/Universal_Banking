import PyPDF2

pdf_path = r"c:\Downloads\Universal Banking\Assessment for Banking Domain.pdf"
with open(pdf_path, 'rb') as f:
    reader = PyPDF2.PdfReader(f)
    text = ""
    for page in reader.pages:
        text += page.extract_text() + "\n\n"

with open(r"c:\Downloads\Universal Banking\extracted_text.txt", 'w', encoding='utf-8') as out:
    out.write(text)

print(f"Extracted {len(reader.pages)} pages")
print("Done!")
