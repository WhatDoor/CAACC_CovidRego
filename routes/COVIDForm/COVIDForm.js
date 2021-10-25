const express = require('express')
const mysql = require('mysql2');
const dateFormat = require('dateformat');
const schedule = require('node-schedule');
const nodemailer = require('nodemailer');
const requestIp = require('request-ip');
const email_validator = require('email-validator');
const propertiesReader = require('properties-reader');

const gUpload = require('./googleSheetsAPI')

//Load properties file
properties = propertiesReader('properties.ini');

var email_user = properties.get('email.user'); 
var email_pass = properties.get('email.pass'); 

//TODO
// - Export calendar thing - iCal or Google Calendar

//Email Transporter
var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: email_user,
      pass: email_pass
    }
  });

//Set up Express Router
const router = express.Router();

var sql_user = properties.get('sql.user'); 
var sql_pass = properties.get('sql.pass'); 

//Set up MySQL
var sql_con = mysql.createConnection({
    host: "localhost",
    user: sql_user,
    password: `${sql_pass}`,
    database: "COVIDTracerDB"
});

sql_con.connect(function(err) {
    if (err) throw err;
    console.log("Main Weekly Rego: MySQL DB Connected!");

    printDB()

    //Query for number of seats already taken up in rego db
    sql_con.query(`SELECT SeatsReserved, date FROM Registrations WHERE date = '${next_sunday_date}'`, reduce_remaining_by_query_result)
});

// Heartbeat for mysql to keep the connection alive
setInterval(function () {
    sql_con.query('SELECT 1');
}, 5000);

//Seats Data
const STARTING_SEATS = properties.get('Form_Values.max_capacity'); 
let seats_remaining = STARTING_SEATS

//Reduce the number of seats remaining by the number of seats already reserved in DB
function reduce_remaining_by_query_result(err, result, fields) {
    for (entry of result) {
        seats_remaining = seats_remaining - entry["SeatsReserved"]
    }
}

//Calculate next Sunday's Date
let next_sunday_date = new Date();
next_sunday_date.setDate(next_sunday_date.getDate() + (7 - next_sunday_date.getDay()) % 7);
next_sunday_date = dateFormat(next_sunday_date, "yyyy-mm-dd")


//Print current registrations for that week
function printDB() {
    sql_con.query(`SELECT Name, SeatsReserved, OtherPersons, email, ContactNumber FROM (SELECT * FROM Registrations WHERE date = '${next_sunday_date}') as x;`, function (err, result, fields) {
        if (err) throw err;
        console.log("Current Registrants:");
        for (entry of result) {
            let log = ""
            for (property in entry) {
                log = log + " | " + entry[property]
            }
            console.log(log);
        }

        //var jsonString = JSON.stringify(result)
        //console.log(jsonString)
    });
}

function sendEmail(TOemail, date, reservationDeets, name) {
    var mailOptions = {
        from: 'jwonghomeiot@gmail.com',
        to: TOemail,
        subject: `Your CAACC Church Registration for ${date}`,
        text: `The details of your reservation are as follows: ${reservationDeets}`
    };
      
    transporter.sendMail(mailOptions, function(error, info){
        if (error) {
            console.log("Email Error for " + name + "\n" + error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });
}

function validInputs(req_body) {
    try {
        //Validate Name - max length 100
        if (typeof req_body.name != "string" && req_body.name.length > 100) {
            console.log("Bad name - " + req_body.name);
            return false
        }

        //Validate Number - 10 numbers in a string
        if (typeof req_body.contact_num != "string" && req_body.contact_num.length > 10) {
            console.log("Bad contact num - " + req_body.contact_num);
            return false
        }

        //Validate Email
        if (req_body.email != "" && !email_validator.validate(req_body.email)) {
            console.log("Bad email - " + req_body.email);
            return false
        }

        //Validate other persons - max length 255
        if (typeof req_body.other_persons != "string" && req_body.other_persons.length > 255) {
            console.log("Bad other persons - " + req_body.other_persons);
            return false
        }

        //Validate number of attendees - between 1 - 7
        if (typeof req_body.num_attendees != "number" && (req_body.num_attendees < 1 || req_body.num_attendees > 7)) {
            console.log("Bad number of attendees - " + req_body.num_attendees);
            return false
        }

        return true
    } catch (err) {
        console.log("Validation Error - likely to do with bad inputs");
    }
}

async function getPriorInputs(IP) {
    // get the client
    const mysql_sync = require('mysql2/promise');

     // create the connection
    const sql_con_sync = await mysql_sync.createConnection({   
    host: "localhost",
    user: sql_user,
    password: `${sql_pass}`,
    database: "COVIDTracerDB"});

    //get most recent week of input
    const [result1, fields1] = await sql_con_sync.execute(`SELECT date from Registrations WHERE IPAddress = '${IP}' ORDER BY date DESC LIMIT 1;`);

    let retDate = "";

    if (result1[0] == undefined) {
        return undefined
    } else {
        retDate = dateFormat(result1[0].date, "yyyy-mm-dd")
    }

    //Get most recently filled input of that week
    const [result2, fields2] = await sql_con_sync.execute(`SELECT * from Registrations WHERE IPAddress = '${IP}' AND date = '${retDate}' ORDER BY entryID DESC LIMIT 1;`);

    return result2[0]
}

async function already_registered(name, contact_num) {
    // get the client
    const mysql_sync = require('mysql2/promise');

     // create the connection
    const sql_con_sync = await mysql_sync.createConnection({   
    host: "localhost",
    user: sql_user,
    password: `${sql_pass}`,
    database: "COVIDTracerDB"});

    const [result, fields] = await sql_con_sync.execute(`SELECT * from Registrations WHERE Name = ? AND ContactNumber = ? AND date = '${next_sunday_date}';`, [name, contact_num]);

    return result[0] != undefined
}

//Triggers on Monday 1AM to reset Sunday Date on Monday Morning and Reset Remaining Seats and OPEN Regos
const weeklyResetTimer = schedule.scheduleJob({hour: 1, minute: 0, dayOfWeek: 1}, weeklyReset);

function weeklyReset() {
    console.log("New week - resetting date/seats and opening registrations");
    
    let next_sunday_check = new Date();
    next_sunday_check.setDate(next_sunday_check.getDate() + (7 - next_sunday_check.getDay()) % 7);
    next_sunday_check = dateFormat(next_sunday_check, "yyyy-mm-dd")

    next_sunday_date = next_sunday_check
    seats_remaining = STARTING_SEATS

    registrations_open = true
}

//Triggers on Sunday 6AM to upload regos to GDrive for ushers and CLOSES Regos
const weeklyUploadTimer = schedule.scheduleJob({hour: 6, minute: 0, dayOfWeek: 0}, trigger_upload);

function trigger_upload() {
    console.log("Uploading regos for ushers and closing registrations");

    sql_con.query(`SELECT Name, SeatsReserved, OtherPersons, email, ContactNumber FROM (SELECT * FROM Registrations WHERE date = '${next_sunday_date}') as x;`, function (err, result, fields) {
        if (err) throw err;
        gUpload.uploadData(result)
    });

    registrations_open = false
}

//Triggers on Saturday 10PM to email current registrations to Aunty Anndey
const weeklyRegistrationUpdateTimer = schedule.scheduleJob({hour: 22, minute: 0, dayOfWeek: 6}, send_registrant_update);

async function send_registrant_update() {
    console.log("Sending an update of the current registrants")

    returnString = ""
    seats_taken = STARTING_SEATS - seats_remaining

    // get the client
    const mysql_sync = require('mysql2/promise');

     // create the connection
    const sql_con_sync = await mysql_sync.createConnection({   
    host: "localhost",
    user: sql_user,
    password: `${sql_pass}`,
    database: "COVIDTracerDB"});

    //get most recent week of input
    const [result1, fields1] = await sql_con_sync.execute(`SELECT Name, SeatsReserved, OtherPersons, email, ContactNumber FROM (SELECT * FROM Registrations WHERE date = '${next_sunday_date}') as x;`);

    for (entry of result1) {
        for (property in entry) {
            returnString = returnString + " | " + entry[property]
        }
    }

    var mailOptions = {
        from: 'jwonghomeiot@gmail.com',
        //to: 'jacobwongzunyi@hotmail.com',
        to: 'anndeyho@gmail.com',
        subject: `Current CAACC Church Registrations for ${next_sunday_date}`,
        text: `Here are the current reservations for this week (${seats_taken} total reservations): \n\n${returnString}`
    };
      
    transporter.sendMail(mailOptions, function(error, info){
        if (error) {
            console.log("Email Error:\n" + error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });
}

//Routing Functions
router.post('/submit', async (req, res, next) => {
    requested_num_of_attendees = req.body.num_attendees
    let reqIP = requestIp.getClientIp(req);

    //Redirect if there are no seats left
    if (seats_remaining - requested_num_of_attendees < 0) {
        res.redirect('/SundayRego/outOfSeats');
    
    //Redirect if that name + contact num has already been registered this week
    } else if (await already_registered(req.body.name, req.body.contact_num)) {
        res.redirect('/SundayRego/already_registered');

    } else {
        if (req.session.ip == requestIp.getClientIp(req)) {
            if (validInputs(req.body)) {
                console.log(`Adding ${req.body.name}`);
                seats_remaining = seats_remaining - parseInt(requested_num_of_attendees)
                console.log(seats_remaining + " seats remaining");

                //Sanitize Inputs - using ? as placeholders escapes them in the library
                sql_query = `INSERT INTO Registrations (Name, SeatsReserved, ContactNumber, OtherPersons, date, email, IPAddress) VALUES (?,?,?,?,'${next_sunday_date}',?,?)`
                sql_values = [
                    req.body.name,
                    requested_num_of_attendees,
                    req.body.contact_num,
                    req.body.other_persons,
                    req.body.email, 
                    reqIP
                ]
    
                sql_con.query(sql_query, sql_values, function (err, result, fields) {
                    if (err) throw err;
                });
                printDB()
                
                if (req.body.email != "") {
                    let reservationDeets = `\n\nName: ${req.body.name}\nNumber Of Attendees: ${requested_num_of_attendees}\nContact Number: ${req.body.contact_num}\nOther Persons: ${req.body.other_persons}`
                    sendEmail(req.body.email, next_sunday_date, reservationDeets, req.body.name)
                }
    
                //Destroy the session, so a new one has to be generated for each post
                //NOTE: If someone wanted to spam, they still could if they just alternated a get request between each post request to get a valid session id. If this becomes a problem, a solution might be to rate limit the number of times an IP can generate a new session id.
                console.log(`Ending session for ${req.session.ip}`);
                req.session.active = false
                req.session.destroy()
    
                return next()
            } else {
                console.log(`Attempted post from ${reqIP} with invalid inputs, dropping request...`);
            }

        } else {
            console.log(`Attempted post from ${reqIP} without valid session, dropping request...`);
        }
    }
}, submitLanding)

function submitLanding(req, res, next) {
    res.render('COVIDsubmit', {
        pageTitle: 'COVIDTrackerBoy - Submitted',
        date: next_sunday_date,
        name: req.body.name,
        seats_reserved: req.body.num_attendees,
        contact_num: req.body.contact_num,
        email: req.body.email,
        other_persons: req.body.other_persons
    });
}

router.get('/outOfSeats', (req, res, next) => {
    let msg = "Sorry, we don't have enough seats left... :("

    res.render('COVIDreject', {
        pageTitle: 'Sorry!',
        message: msg
    });
})

router.get('/already_registered', (req, res, next) => {
    let msg = "You have already registered this name and number for this week, see you at church!"

    res.render('COVIDreject', {
        pageTitle: 'Sorry!',
        message: msg
    });
})

let registrations_open = true

router.get('/', async (req, res, next) => {
    if (registrations_open) {
        //Set up a session and make it active
        let reqIP = requestIp.getClientIp(req);
        req.session.ip = reqIP

        console.log(`Session started by: ${reqIP}`);
        let priorInputs = await getPriorInputs(reqIP)

        if (priorInputs == undefined) {
            priorInputs = {}
            priorInputs.Name = ""
            priorInputs.SeatsReserved = 1
            priorInputs.ContactNumber = ""
            priorInputs.email = ""
            priorInputs.OtherPersons = ""
        }

        res.render('COVIDForm', {
            pageTitle: 'COVIDTrackerBoy',
            path: '/home',
            seats: seats_remaining,
            date: next_sunday_date,
            priorInputs: priorInputs
        });
            
    } else {
        res.render('COVIDclosed', {
            pageTitle: 'COVIDTrackerBoy',
            path: '/home',
            seats: seats_remaining,
            date: next_sunday_date
        });
    }  
})

exports.routes = router;