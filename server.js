const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const db = require('./db');

app.use(express.json());

// Define route to create a new contact
app.post('/contacts', (req, res) => {
    const { phoneNumber, email } = req.body;
    const createdAt = new Date();
    const updatedAt = new Date();

    // Check if phoneNumber or email already exists in the database
    const checkQuery = 'SELECT * FROM contacts WHERE phoneNumber = ? OR email = ?';
    const checkValues = [phoneNumber, email];

    db.query(checkQuery, checkValues, (err, results) => {
        if (err) {
            console.error('Error checking existing data:', err);
            return res.status(500).send('Error checking existing data');
        }

        if (results.length > 0) {
            // If phoneNumber or email already exists
            const existingContact = results[0]; // Assuming only one contact matches

            let linkedId = existingContact.id;
            if (existingContact.linkPrecedence === 'secondary') {
                // Use the linkedId of the existing secondary contact
                linkedId = existingContact.linkedId;
            }

            const query = `INSERT INTO contacts (phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`;
            const values = [
                phoneNumber,
                email,
                linkedId, // Use the existing contact's linkedId if it's a secondary contact
                linkedId ? 'secondary' : 'primary', // Set linkPrecedence accordingly
                createdAt,
                updatedAt
            ];

            db.query(query, values, (err, result) => {
                if (err) {
                    console.error('Error inserting data:', err);
                    res.status(500).send('Error inserting data');
                    return;
                }
                res.status(201).send('Contact created successfully');
            });
        } else {
            // If phoneNumber and email do not exist, insert as new primary contact
            const query = `INSERT INTO contacts (phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`;
            const values = [
                phoneNumber,
                email,
                null, // No linkedId (new primary contact)
                'primary', // Set linkPrecedence to primary
                createdAt,
                updatedAt
            ];

            db.query(query, values, (err, result) => {
                if (err) {
                    console.error('Error inserting data:', err);
                    res.status(500).send('Error inserting data');
                    return;
                }
                res.status(201).send('Contact created successfully as new primary contact');
            });
        }
    });
});




// Define route to get contacts by phone number or email
app.get('/contacts', (req, res) => {
    console.log(`Server is running on port ${port}`);
    const { phoneNumber, email } = req.query;

    if (!phoneNumber && !email) {
        return res.status(400).send('Phone number or email is required');
    }

    let query = 'SELECT * FROM contacts WHERE ';
    const values = [];

    if (phoneNumber) {
        query += 'phoneNumber = ? ';
        values.push(phoneNumber);
    }

    if (email) {
        if (phoneNumber) query += 'OR ';
        query += 'email = ? ';
        values.push(email);
    }

    console.log(`Query: ${query}`);
    console.log(`Values: ${values}`);

    db.query(query, values, (err, results) => {
        if (err) {
            console.error('Error retrieving data:', err);
            return res.status(500).send('Error retrieving data');
        }

        if (results.length === 0) {
            // No matching contact found, insert as new primary contact
            const createdAt = new Date();
            const updatedAt = new Date();
            const insertQuery = `INSERT INTO contacts (phoneNumber, email, linkedId, linkPrecedence, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`;
            const insertValues = [
                phoneNumber,
                email,
                null, // No linkedId (new primary contact)
                'primary', // Set linkPrecedence to primary
                createdAt,
                updatedAt
            ];

            db.query(insertQuery, insertValues, (insertErr, insertResult) => {
                if (insertErr) {
                    console.error('Error inserting data:', insertErr);
                    return res.status(500).send('Error inserting data');
                }

                const formattedResponse = {
                    contact: {
                        primaryContactId: insertResult.insertId,
                        emails: [email],
                        phoneNumbers: [phoneNumber],
                        secondaryContactIds: []
                    }
                };

                return res.status(201).json(formattedResponse);
            });
        } else {
            console.log('Results:', results);

            // If both phone number and email are provided
            if (phoneNumber && email) {
                const phonePrimary = results.find(contact => contact.phoneNumber === phoneNumber && contact.linkPrecedence === 'primary');
                const emailPrimary = results.find(contact => contact.email === email && contact.linkPrecedence === 'primary');

                if (phonePrimary && emailPrimary && phonePrimary.id !== emailPrimary.id) {
                    // Both phone number and email are primary contacts but different, merge them
                    const younger = phonePrimary.createdAt < emailPrimary.createdAt ? phonePrimary : emailPrimary;
                    const older = phonePrimary.createdAt < emailPrimary.createdAt ? emailPrimary : phonePrimary;

                    // Update the younger contact to be secondary
                    const updateYoungerQuery = `UPDATE contacts SET linkedId = ?, linkPrecedence = 'secondary' WHERE id = ?`;
                    db.query(updateYoungerQuery, [older.id, younger.id], (updateErr) => {
                        if (updateErr) {
                            console.error('Error updating younger contact:', updateErr);
                            return res.status(500).send('Error updating younger contact');
                        }

                        // Update all contacts linked to the younger contact to link to the older contact
                        const updateLinkedQuery = `UPDATE contacts SET linkedId = ? WHERE linkedId = ?`;
                        db.query(updateLinkedQuery, [older.id, younger.id], (linkUpdateErr) => {
                            if (linkUpdateErr) {
                                console.error('Error updating linked contacts:', linkUpdateErr);
                                return res.status(500).send('Error updating linked contacts');
                            }

                            // Retrieve updated contacts
                            const finalQuery = 'SELECT * FROM contacts WHERE id = ? OR linkedId = ?';
                            db.query(finalQuery, [older.id, older.id], (finalErr, finalResults) => {
                                if (finalErr) {
                                    console.error('Error retrieving final data:', finalErr);
                                    return res.status(500).send('Error retrieving final data');
                                }

                                const formattedResponse = {
                                    contact: {
                                        primaryContactId: older.id,
                                        emails: finalResults.filter(contact => contact.email).map(contact => contact.email),
                                        phoneNumbers: finalResults.filter(contact => contact.phoneNumber).map(contact => contact.phoneNumber),
                                        secondaryContactIds: finalResults.filter(contact => contact.linkPrecedence === 'secondary').map(contact => contact.id),
                                    }
                                };

                                return res.status(200).json(formattedResponse);
                            });
                        });
                    });
                } else {
                    console.log('Results:', results);
        
                    // Find the primary contact ID if the found contact is a secondary contact
                    let primaryContactId = null;
                    let primaryContactEmail = null;
                    let primaryContactPhoneNumber = null;
        
                    const primaryContact = results.find(contact => contact.linkPrecedence === 'primary');
                    if (primaryContact) {
                        primaryContactId = primaryContact.id;
                        primaryContactEmail = primaryContact.email;
                        primaryContactPhoneNumber = primaryContact.phoneNumber;
        
                        // Prepare the structured response format
                        const formattedResponse = {
                            contact: {
                                primaryContactId: primaryContactId,
                                emails: results.filter(contact => contact.email).map(contact => contact.email),
                                phoneNumbers: results.filter(contact => contact.phoneNumber).map(contact => contact.phoneNumber),
                                secondaryContactIds: results.filter(contact => contact.linkPrecedence === 'secondary').map(contact => contact.id),
                            }
                        };
        
                        return res.status(200).json(formattedResponse);
                    } else {
                        // If no primary contact found, get the linkedId and find the primary contact
                        const secondaryContact = results[0]; // Assuming only one secondary contact per query result
                        const linkedId = secondaryContact.linkedId;
        
                        const primaryQuery = 'SELECT * FROM contacts WHERE id = ?';
                        db.query(primaryQuery, [linkedId], (err, primaryResults) => {
                            if (err) {
                                console.error('Error retrieving primary contact data:', err);
                                return res.status(500).send('Error retrieving primary contact data');
                            }
        
                            if (primaryResults.length === 0) {
                                return res.status(404).json({ error: 'Primary contact not found' });
                            }
        
                            const primaryContact = primaryResults[0];
                            primaryContactId = primaryContact.id;
                            primaryContactEmail = primaryContact.email;
                            primaryContactPhoneNumber = primaryContact.phoneNumber;
        
                            // Prepare the structured response format
                            const formattedResponse = {
                                contact: {
                                    primaryContactId: primaryContactId,
                                    emails: results.filter(contact => contact.email).map(contact => contact.email),
                                    phoneNumbers: results.filter(contact => contact.phoneNumber).map(contact => contact.phoneNumber),
                                    secondaryContactIds: results.filter(contact => contact.linkPrecedence === 'secondary').map(contact => contact.id),
                                }
                            };
        
                            return res.status(200).json(formattedResponse);
                        });
                    }
                }
            } else {
                console.log('Results:', results);
    
                // Find the primary contact ID if the found contact is a secondary contact
                let primaryContactId = null;
                let primaryContactEmail = null;
                let primaryContactPhoneNumber = null;
    
                const primaryContact = results.find(contact => contact.linkPrecedence === 'primary');
                if (primaryContact) {
                    primaryContactId = primaryContact.id;
                    primaryContactEmail = primaryContact.email;
                    primaryContactPhoneNumber = primaryContact.phoneNumber;
    
                    // Prepare the structured response format
                    const formattedResponse = {
                        contact: {
                            primaryContactId: primaryContactId,
                            emails: results.filter(contact => contact.email).map(contact => contact.email),
                            phoneNumbers: results.filter(contact => contact.phoneNumber).map(contact => contact.phoneNumber),
                            secondaryContactIds: results.filter(contact => contact.linkPrecedence === 'secondary').map(contact => contact.id),
                        }
                    };
    
                    return res.status(200).json(formattedResponse);
                } else {
                    // If no primary contact found, get the linkedId and find the primary contact
                    const secondaryContact = results[0];
                     // Assuming only one secondary contact per query result
                    const linkedId = secondaryContact.linkedId;
    
                    const primaryQuery = 'SELECT * FROM contacts WHERE id = ?';
                    db.query(primaryQuery, [linkedId], (err, primaryResults) => {
                        if (err) {
                            console.error('Error retrieving primary contact data:', err);
                            return res.status(500).send('Error retrieving primary contact data');
                        }
    
                        if (primaryResults.length === 0) {
                            return res.status(404).json({ error: 'Primary contact not found' });
                        }
    
                        const primaryContact = primaryResults[0];
                        primaryContactId = primaryContact.id;
                        primaryContactEmail = primaryContact.email;
                        primaryContactPhoneNumber = primaryContact.phoneNumber;
    
                        // Prepare the structured response format
                        const formattedResponse = {
                            contact: {
                                primaryContactId: primaryContactId,
                                emails: results.filter(contact => contact.email).map(contact => contact.email),
                                phoneNumbers: results.filter(contact => contact.phoneNumber).map(contact => contact.phoneNumber),
                                secondaryContactIds: results.filter(contact => contact.linkPrecedence === 'secondary').map(contact => contact.id),
                            }
                        };
    
                        return res.status(200).json(formattedResponse);
                    });
                }
            }
        }
    });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
