function mapPersonToEmployee(Person person) returns Employee => {
    fullName: person.name,
    age: person.age
};

function formatName(string name) returns string {
    return name.toUpperAscii();
}
