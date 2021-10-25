CREATE TABLE Registrations(  
    entryID int PRIMARY KEY AUTO_INCREMENT,
    Name VARCHAR(255),
    SeatsReserved VARCHAR(255),
    ContactNumber VARCHAR(255),
    OtherPersons VARCHAR(255),
    date DATETIME,
    email VARCHAR(255),
    IPAddress VARCHAR(255)
);