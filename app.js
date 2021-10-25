const express = require('express')
const bodyParser = require('body-parser')
const path = require('path')
const http = require('http')
const https = require('https')
const fs = require('fs')
const favicon = require('serve-favicon');
const session = require('express-session')
const propertiesReader = require('properties-reader');

//Load properties file
properties = propertiesReader('properties.ini');

const app = express()
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')))

//Setting up Session Middleware
app.use(session({
    secret: properties.get('server.session_middleware_secret'),
    resave: true,
    saveUninitialized: false,
    cookie: { secure: true }
}))

app.set('view engine', 'ejs')

//Ensure that http requests are redirected to https
app.enable('trust proxy');
app.use (function (req, res, next) {
    if (req.secure) {
            // request was via https, so do no special handling
            next();
    } else {
            // request was via http, so redirect to https
            res.redirect('https://' + req.headers.host + req.url);
    }
});

//Routing
const COVIDForm = require('./routes/COVIDForm/COVIDForm.js')
//const COVIDForm_Event = require('./routes/COVIDForm/COVIDForm_Event')

//Middleware to accept variables in post requests
app.use(bodyParser.urlencoded({extended: false}))

app.use('/CAACC', COVIDForm.routes)
//app.use(`/${COVIDForm_Event.event_link}`, COVIDForm_Event.routes)

app.get('/', (req, res, next) => {
    res.send("HOME");
})

//Middleware for parsing the request body
app.use(express.static(path.join(__dirname, 'public'))); //Enables access of the public folder
app.use(bodyParser.json({limit: '50mb'}))

app.use('/', (req, res, next) => {
    res.status(404).render('404', {
        pageTitle: 'Page Not Found',
        path: '/'
    });
});

// Certificates for HTTPS
const privateKey = fs.readFileSync(properties.get('server.privateKey'), 'utf8');
const certificate = fs.readFileSync(properties.get('server.certificate'), 'utf8');

const options = {
	key: privateKey,
	cert: certificate,
};

http.createServer(app).listen(properties.get('server.http_port'))
https.createServer(options, app).listen(properties.get('server.https_port'))

console.log("COVID Rego Ready!");