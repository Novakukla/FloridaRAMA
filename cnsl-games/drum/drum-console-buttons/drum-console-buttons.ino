/*
 *  CENT/CNS/DRUM
 *  
 *  Interactive Touchless Button Console for Fairgrounds Centcom Exhibit
 *  
 *  code waits for "handshake" string message from reactor
 *  replies back with "ready" string message to reactor
 *  after handshake/ready, the triggered sensors 
 *  are sent via serial, using UDP_OUTPUT_ADDR
 *  
 *  Copyright : Fairgrounds Inc. 2021
 *  
 */

//------------------------------------------------------------------
// DEBUG

#define DEBUG_UDP  false
#define DEBUG_BTN  false

//------------------------------------------------------------------
// only uncomment one of these at at time for testing

// test sensor ranges (use ENABLE_BUTTONS to go one at a time)
#define RANGE_TEST false

// test LEDs. this runs through all the button positions
#define LED_TEST   false

//------------------------------------------------------------------

#define ENABLE_UDP true

//------------------------------------------------------------------
// TOUCHLESS BUTTONS

#define NUM_BTNS  11 // radio equals three
#define NUM_RADIO 3  // number of grouped radio buttons
int currRadioId = -1;

 // these button indicies are bound together as a radio group
 // represents the index position in the touchless buttons array
const int RADIO_GROUP[NUM_RADIO] = { 8, 9, 10 };

/* SENSOR CONFIG */ 
#define SMOOTHING 20  // running avg (higher num = more smoothing)

// not currently used
//#define BTN_TYPE  1  // btn sensor type (1 = Sharp IR:GP2Y0A21YK0F)
//------------------------------------------------------------------
// NEOPIXELS

#include <Adafruit_NeoPixel.h>
#include "UdpSerial.h"
#include "TouchlessButton.h"

/* CONFIG */ #define DATA_PIN   2
/* CONFIG */ #define NUM_PIXELS 270
/* CONFIG */ #define BRIGHTNESS 255

Adafruit_NeoPixel strip = 
Adafruit_NeoPixel(NUM_PIXELS, DATA_PIN, NEO_GRB + NEO_KHZ800);

// holds color values
// assigned in setup
byte consoleColor1,
     consoleColor2, 
     consoleColor3;

// lighting ranges for console 
// (from pixel / to pixel)
const int pixelRange[NUM_BTNS][2] = {
/*a1*/ { 260, 269 },
/*a2*/ { 249, 257 },
/*a3*/ { 238, 246 },
/*a4*/ { 227, 235 },
/*a5*/ { 216, 224 },
/*a6*/ { 205, 213 },
/*a7*/ { 194, 202 },
/*a8*/ { 183, 191 },
  
/*b1*/ { 0,   59  },
/*b2*/ { 60,  119 },
/*b3*/ { 120, 179 },
 };

// keep track of which lights are on/off
int ledState[NUM_BTNS] = {
  /*a1*/ true,
  /*a2*/ true,
  /*a3*/ true,
  /*a4*/ true,
  /*a5*/ true,
  /*a6*/ true, 
  /*a7*/ true,
  /*a8*/ true,
  /*b1*/ true,
  /*b2*/ true,
  /*b3*/ true,
 };
//------------------------------------------------------------------
// analog pin ranges

// uncomment the microcontroller in use below:

// Arduino - MEGA 2560 ------------------
// #define PIN_A0   (54) // starts at 54
// #define PIN_A1   (55)
// etc
#define FIRST_ANALOG_PIN 54
#define LAST_ANALOG_PIN  69

// Arduino - UNO R3 --------------------
//#define FIRST_ANALOG_PIN 14
//#define LAST_ANALOG_PIN  19

//------------------------------------------------------------------
// SENSOR CONFIG

// Enable or disable individual buttons
const bool ENABLE_BUTTONS [NUM_BTNS] 
{ 
  /*a1*/ true,
  /*a2*/ true,
  /*a3*/ true,
  /*a4*/ true,
  /*a5*/ true,
  /*a6*/ true, 
  /*a7*/ true,
  /*a8*/ true,
  /*b1*/ true,
  /*b2*/ true,
  /*b3*/ true,
 };

// set min/max thresholds for each sensor
// triggered is anything between these ranges
const int thresholds [NUM_BTNS][2] = {
  /*a1*/ { 3, 5 },
  /*a2*/ { 3, 5 },
  /*a3*/ { 3, 5 },
  /*a4*/ { 3, 5 },
  /*a5*/ { 3, 5 },
  /*a6*/ { 3, 5 },
  /*a7*/ { 3, 5 },
  /*a8*/ { 3, 5 },
  
  /*b1*/ { 3, 5 },
  /*b2*/ { 3, 5 },
  /*b3*/ { 3, 5 },
 };

/*
 * set each btn behavior
 * 
 * 1 - momentary
 * 2 - toggle
 * 3 - radio
 * 4 - continous
 */
const int behaviors[NUM_BTNS] = { 
  /*a1*/ 2, //toggle
  /*a2*/ 2, //toggle
  /*a3*/ 2, //toggle
  /*a4*/ 2, //toggle
  /*a5*/ 2, //toggle
  /*a6*/ 2, //toggle
  /*a7*/ 2, //toggle
  /*a8*/ 2, //toggle
  
  /*b1*/ 3, //radio
  /*b2*/ 3, //radio
  /*b3*/ 3, //radio
 };



//------------------------------------------------------------------
// UDP CONFIG

// simulate receiving messages over udp
UdpSerial udpSerial; // receive serial messages

bool receivedHandshake = false; // special handshake from host

// list of URL addresses that correspond to commands
String UDP_INPUT_COMMANDS [] = {

   // global ---------------
   // activation handshake to confirm connection between arduino and host
  "/cent/cns/drum/handshake", 
  
  // a buttons -------------
  "/cent/cns/drum/a1",
  "/cent/cns/drum/a2",
  "/cent/cns/drum/a3",
  "/cent/cns/drum/a4",
  "/cent/cns/drum/a5",
  "/cent/cns/drum/a6",
  "/cent/cns/drum/a7",
  "/cent/cns/drum/a8",

  // b buttons
  "/cent/cns/drum/b1",
  "/cent/cns/drum/b2",
  "/cent/cns/drum/b3"
};

String UDP_OUTPUT_ADDR [] = {

  // IMPORTANT: 
  // commands go in order of the
  // assigned analog pins; 
  
  // so for example..
  
  // A0 = physical button no.1, 
  // A1 = physical button no.2, 
  // A2 = ""              no.3, 
  // etc
  
  // a buttons -------------
  "/cent/cns/drum/a1",
  "/cent/cns/drum/a2",
  "/cent/cns/drum/a3",
  "/cent/cns/drum/a4",
  "/cent/cns/drum/a5",
  "/cent/cns/drum/a6",
  "/cent/cns/drum/a7",
  "/cent/cns/drum/a8",

  // b buttons
  "/cent/cns/drum/b1",
  "/cent/cns/drum/b2",
  "/cent/cns/drum/b3"
};

//------------------------------------------------------------------

// array of touchless buttons
TouchlessButton * touchlessButtons[NUM_BTNS];

//------------------------------------------------------------------
// TIMING & FLOW CONTROL VARS

long lastPingTime     = 0;
int  pingDelay        = 10000;
long lastTriggerTime  = 0;
int  triggerDelay     = 500;
int  numOfRegCommands = 0;

//------------------------------------------------------------------

void setup() {

  numOfRegCommands = sizeof(UDP_INPUT_COMMANDS) / sizeof(*UDP_INPUT_COMMANDS); 
  udpSerial.init(9600); // initializes serial port
  
  // udpSerial.debug = true;
  // what function to run when a udp command is received
  udpSerial.OnMessageReceived   = onMessageReceived;
  udpSerial.OnHandshakeReceived = onHandshakeReceived;

  // --------------------------------------------------
  // LIGHTING SETUP
  //set pinmode
  pinMode(DATA_PIN, OUTPUT);

  strip.begin();
  strip.setBrightness(BRIGHTNESS); // set brightness  
  strip.show(); // Initialize all pixels to 'off'  
  
  // --------------------------------------------------
  // BUTTON SETUP
  for(int i = 0; i < NUM_BTNS; i++) {

    // buttons not instantiated if disabled
    if(ENABLE_BUTTONS[i] == true) { 

      if(DEBUG_BTN) { Serial.print("Creating new button "); Serial.println(i); }

      int analogPin = FIRST_ANALOG_PIN + i;
 
      int buttonIndex  = i; // IMPORTANT: the index of the output commands

      if(analogPin <= LAST_ANALOG_PIN) {
  
        touchlessButtons[i] = new TouchlessButton(buttonIndex, analogPin, behaviors[i]);
        

        int minRange = thresholds[i][0];
        int maxRange = thresholds[i][1];
      
        touchlessButtons[i]->setThreshold(minRange, maxRange); //set min/max range cm

        // event handler for button presses
        touchlessButtons[i]->onButtonTriggered = onButtonTriggered;
      }
    }
  }
}

//------------------------------------------------------------------
  
void loop() { 

  // --------------------------------------------------
  if(LED_TEST) {
    for(int i = 0; i < NUM_BTNS; i++) {
    int fromPixel = pixelRange[i][0];
    int toPixel   = pixelRange[i][1];
    lightOn(fromPixel, toPixel);
    Serial.print("ON ->");
    Serial.print("\t");
    Serial.print(fromPixel);
    Serial.print("\t");
    Serial.print(toPixel);
    Serial.println();
    delay(250);
    lightOff(fromPixel, toPixel);
    delay(10);
    }
    Serial.println();
  }
  // --------------------------------------------------
  
  if(ENABLE_UDP) {
    checkUdp();
    heartbeat();
  }

  // --------------------------------------------------

  if( receivedHandshake || DEBUG_BTN || RANGE_TEST) { // run the normal execution loop
    // update touchless buttons
    for(int i = 0; i < NUM_BTNS; i++) {
      if(ENABLE_BUTTONS[i]) {
        touchlessButtons[i]->update();
      }
    }
    //recommended recovery time for ADC
    //https://www.quora.com/Why-is-a-little-delay-needed-after-analogRead-in-Arduino
  }
}

//------------------------------------------------------------------

void heartbeat() {
  if(millis() - lastPingTime > pingDelay && !RANGE_TEST) {
    lastPingTime = millis();
    Serial.println("heartbeat");
  }
}

//------------------------------------------------------------------

void checkUdp() {

  // --------------------------------------------------
  // UDP COMMS : Always be check'n
  //
  // this is how Arduino communicates with reactor

  // we still need to call this to continually check the serial port
  // update udp serial
  udpSerial.update(); 
}

//------------------------------------------------------------------

void setPlayhead(uint8_t n, uint32_t c) {
  
  // turnOff();
  for (uint8_t i = 0; i < 60; i++) {
    strip.setPixelColor(i, strip.Color(0,0,0));
  }
  for (uint8_t i = 0; i < n; i++) {
    strip.setPixelColor(i, c);
  }
  strip.show();
}

//------------------------------------------------------------------

void lightOn(int fromPixel, int toPixel) {
  for (int px = fromPixel; px < toPixel + 1; px++) {
    strip.setPixelColor(px, strip.Color(0, 0, 255)); // TODO: make preset colors
  }
  strip.show();
}

//------------------------------------------------------------------

void lightOff(int fromPixel, int toPixel) {
  for (int px = fromPixel; px < toPixel + 1; px++) {
    //set black for off
    strip.setPixelColor(px, strip.Color(0, 0, 0)); 
  }
  strip.show();
}

//------------------------------------------------------------------

void allLightsOff() {
  for (uint8_t i = 0; i < strip.numPixels(); i++) {
    strip.setPixelColor(i, strip.Color(0, 0, 0));
  }
  strip.show();
}

//------------------------------------------------------------------

void allLightsOn() {
  for (uint8_t i = 0; i < strip.numPixels(); i++) {
    strip.setPixelColor(i, strip.Color(0, 0, 255));
  }
  strip.show();
}

//------------------------------------------------------------------

int stringToInt(String str) {
  char charHolder[str.length()+1];
  str.toCharArray(charHolder,str.length()+1);
  str = "";
  int _recievedVal = atoi(charHolder);
  return _recievedVal;
}

//------------------------------------------------------------------

// Fill the dots one after the other with a color
void colorWipe(uint32_t c, uint8_t wait) {
  for (uint16_t i = 0; i < strip.numPixels(); i++) {
    strip.setPixelColor(i, c);
    //strip.setPixelColor((i + STARTPIXEL) % 60, c);
    strip.show();
    delay(wait);
  }
}

//------------------------------------------------------------------
// TOUCHLESS BUTTON

void onButtonTriggered(int buttonIndex, int buttonVal) {

  // send UPD command to nodejs
  
  if(ENABLE_UDP && !RANGE_TEST) {
    String val = String( buttonVal, 10);
    String msg = String( UDP_OUTPUT_ADDR[buttonIndex] + " " + val);
    Serial.println( msg );
  }

  // activate lighting feedback
  if(!RANGE_TEST) {
    // activate lighting feedback
    int fromPixel = pixelRange[buttonIndex][0];
    int toPixel   = pixelRange[buttonIndex][1];
    
    switch( behaviors[buttonIndex] ) {
     case 1: // trigger
        //TODO: momentary light
        break;
     case 2: // 
        // TODO: toggle light on/off
        ledState[buttonIndex] = buttonVal > 0;
        if(ledState[buttonIndex] ) {
          lightOn(fromPixel, toPixel);
        } else {
          lightOff(fromPixel, toPixel);
        }
        break;
     case 3: // radio
       // TODO: activate 1, deactivate others in group
       ledState[buttonIndex] = buttonVal > 0;
       if(ledState[buttonIndex] ) {
        lightOn(fromPixel, toPixel);
       } else {
        lightOff(fromPixel, toPixel);
       }
       break;
     case 4: // continuous
      // TODO: ?
      break;
     default:
      break; 
    }
  }

  
}


//------------------------------------------------------------------
void onHandshakeReceived() {
  
  Serial.println("ready"); // send ready signal
  receivedHandshake = true;
}

//------------------------------------------------------------------
// UDP DEVICE COMMANDS

void onMessageReceived(String url, int value) {

  if(DEBUG_UDP) Serial.println(url);

  int  found_index = -1;
  bool invalid = false;

  for(int i = 0; i < numOfRegCommands; i++) {
    // Check to see if the URL is listed in the registered commands array
    
    if( UDP_INPUT_COMMANDS[i].indexOf(url) == 0 ) {

      //prevent parts of urls from matching/triggering multiple commands
      if(found_index >=0) {
        invalid = true;
        break;
      }
      
      found_index = i;

      if(DEBUG_UDP) {
        Serial.print("Found match for command : ");
        Serial.print(UDP_INPUT_COMMANDS[i]);
        Serial.print(" @ index -> ");
        Serial.println(i);
      }
    }
  }

  if(found_index >= 0 && !invalid) {
    runCommand(found_index, value);  
  }
}

//------------------------------------------------------------------

void runCommand(int command, int value) {

  if(ENABLE_UDP) {
  
    switch (command) {
      case 0: //.../a1
        Serial.print("../a1 ");
        Serial.println(value);
        break;
      case 1: //.../a2
        Serial.print("../a2 ");
        Serial.println(value);
        break;
      case 2: //.../a3
        Serial.print("../a3 ");
        Serial.println(value);
        break;
      case 3: //.../a4
        Serial.print("../a4 ");
        Serial.println(value);
        break;
      case 4: //.../a5
        Serial.print("../a5 ");
        Serial.println(value);
        break;
      case 5: //.../a6
        Serial.print("../a6 ");
        Serial.println(value);
        break;
      case 6: //.../a7
        Serial.print("../a7 ");
        Serial.println(value);
        break;
      case 7: //.../a8
        Serial.print("../a8 ");
        Serial.println(value);
        break;
      case 8: //.../b1
        
        setPlayhead(value, strip.Color(0,255,255) );
        Serial.print("../b1 ");
        Serial.println(value);
        
        break;
      case 9: //.../b2
        Serial.print("../b2 ");
        Serial.println(value);
        break;
      case 10: //.../b3
        Serial.print("../b3 ");
        Serial.println(value);
        break;
      default:
        break;
    } 
  }
}
