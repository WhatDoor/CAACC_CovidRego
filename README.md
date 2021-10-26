# CAACC_CovidRego

3 pre-reqs required for setup:

## MySQL DB

Install an sql db, create a DB called 'COVIDTracerDB' and then run the sql script to create the table. 

## Properties.ini

Rename properties_template.ini to properties.ini and then put in the relevant values.

## google_sheet_creds.json

Rename google_sheet_creds_template.json to google_sheet_creds.json and then put in relevant values.

This part is using the 'google-spreadsheet' npm package, and calls `useServiceAccountAuth` on this json file. 

## Run

Run `npm install`
Run `node app.js`
