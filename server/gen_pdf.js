const { jsPDF } = require('jspdf');
const fs = require('fs');
const doc = new jsPDF();
doc.text('This is a test PDF for summarization. Artificial intelligence is transforming how we work.', 10, 10);
fs.writeFileSync('test.pdf', doc.output(), 'binary');
console.log('test.pdf created');
