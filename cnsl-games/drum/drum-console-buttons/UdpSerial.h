/*
  UdpSerial.h
  Library for simulating UDP messages over Serial

  by Fairgrounds Projects
*/

#include <Regexp.h>

// requires lib <Regexp.h>
class UdpSerial {

  public:
    bool debug = false;

    //void init(char *urls[], int len);
    void init(int baud);
    void update();
    void clear();

    int getBaud();
    void setBaud(int baud);

    bool hasMessage();
    void parseMessage();

    String getValue();
    String getUrl();

    void (*OnMessageReceived) (String url, int val);
    void (*OnHandshakeReceived) ();

  private:

    int    baud = 9600;
    
    bool   readyToRead = false;
    bool   receivedHandshake = false;
    
    String inputString = "";
    
    // simulate udp addr + value
    // e.g: "/centcom/console/drum/b1 5"

    String inputUrl = ""; //udp addr
    String inputVal = ""; // udp val


    //option to make discrete length
    static const byte maxBufLen = 64;

    stringToInt(String str);

//    char receivedChars[numChars];
};

//------------------------------------------------------------------

void UdpSerial::setBaud(int b) {
  baud = b;
  Serial.end();
  Serial.begin(baud);
}

int UdpSerial::getBaud() {
  return baud;
}

void UdpSerial::parseMessage() {

    MatchState ms; //matchstate object (requirs regex lib)

    //search target
    char buf [maxBufLen];
    inputString.toCharArray(buf, maxBufLen);

    //set target buffer
    ms.Target(buf);

    // check if we are handshaking first
    if( ms.Match ("handshake") ) { // initial handshake

      this->receivedHandshake = true;
      
    } else { // proceed to regular parsing

       // --------------------------
       // set : input command : url
       
      if( ms.Match ("(.+)%s") ) {
        //lua pattern: everything before space char
  
        char cap[maxBufLen];
        ms.GetCapture(cap, 0);
        inputUrl = String(cap);
      }

      // --------------------------
      // set: input command : value
      
      if( ms.Match ("(%S+)$") ) {
        //lua pattern: everything after, that is NOT the space char
  
        char cap[maxBufLen];
        ms.GetCapture(cap, 0);
        inputVal = String(cap);
      }
      
    }
}

////------------------------------------------------------------------
//
//String UdpSerial::getValue() {
//  return inputVal;
//}

//------------------------------------------------------------------

String UdpSerial::getUrl() {
  return inputUrl;
}

//------------------------------------------------------------------

void UdpSerial::clear() {
  readyToRead = false;
  receivedHandshake = false;
  inputString = "";
  inputUrl = ""; //udp addr
  inputVal = ""; // udp val
}

//------------------------------------------------------------------

// INITIALIZE SERIAL

void UdpSerial::init(int b) {
  baud = b;
  Serial.begin(baud);
  delay(1000);
}


// UPDATE

void UdpSerial::update() {

  while(Serial.available() && !readyToRead) {
    char inChar = (char)Serial.read();

    if(inChar == '\n') {
      this->parseMessage();
      readyToRead = true;
      
    } else {
      inputString += inChar;
    }
  }

  if(readyToRead) {

    // 1. execute registered handshake callback
    if(receivedHandshake) 
    {
      OnHandshakeReceived();
    } 
    
    // 2. execute registered message callback 
    else 
    { 
      OnMessageReceived(inputUrl, stringToInt(inputVal));
    }
    
    // clears own buffers and flags
    clear(); 
  }
}

int UdpSerial::stringToInt(String str) {
    char charHolder[str.length()+1];
    str.toCharArray(charHolder,str.length()+1);
    str = "";
    int _recievedVal = atoi(charHolder);
    return _recievedVal;
}

//------------------------------------------------------------------

// HAS MESSAGE?

bool UdpSerial::hasMessage() {
  return readyToRead;
}

//// GET MESSAGE
//
//String UdpSerial::getMessage() { //clears last message
//
//  String msg = "";
//  if(readyToRead) {
//    msg = inputString;
//    readyToRead = false;
//  }
//  return msg;
//}
