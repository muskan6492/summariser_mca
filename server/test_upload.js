const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data'); // Need to install this or use alternative

async function testUpload() {
    try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream('test.pdf'));

        const response = await axios.post('http://localhost:5001/api/upload', formData, {
            headers: formData.getHeaders()
        });

        console.log('Response:', response.data);
    } catch (error) {
        console.error('Test Failed:', error.response?.data || error.message);
    }
}

testUpload();
