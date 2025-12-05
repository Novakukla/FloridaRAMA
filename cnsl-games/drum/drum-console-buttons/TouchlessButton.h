/*
 * @class TouchLessButton
 * @author Fairgrounds Inc. 2021
 */

//------------------------------------------------------------------
class TouchlessButton {

  public:
  
    TouchlessButton(int id, int pin, int behavior);

    /*
     * @param behavior
     * 
     * 1 - momentary
     * 2 - toggle
     * 3 - radio
     * 4 - continous
     */
    
    void init(int id, int pin);
    void update();
    void setThreshold(int minThreshold, int maxThreshold);
    void setTriggerDelay(int delayTime);
    void (*onButtonTriggered)  (int buttonId, int buttonVal);

    int getValue(); // gets the latest smoothed value

    // sets the button behavior
    void disableAllBehaviors();
    void makeToggleButton();
    void makeRadioButton(); // TODO: pass array to set radio group
    void makeContinousControl();
    void makeMomentaryButton();

//    int radioGroup[NUM_RADIO];
    
  private:

    void setBehavior(int behavior);
    
    // behavior set at instantiation
    bool _isTrigger    = false;  // act like momentary btn
    bool _isToggle     = false;  // act like toggle btn
    bool _isRadio      = false;  // act like radio btn
    bool _isCControl   = false;  // act like continuous controller

    bool _toggleOn  = false;  // keep track of toggle state

    int  calcRunningAverage();
    int  sumArray();
    
    int  _buttonId;  //simple index id 
    int  _analogPin;
    int  _currValue;
    int  _minThreshold;
    int  _maxThreshold;
    int  _recoveryTime;  //ms

    int  _triggerConfirmDelay = 200; //ms for debounce
    bool _unconfirmedTrigger = false;
    long _lastConfirmedTriggerTime = 0;
    long _lastUnconfirmedTriggerTime = 0;

    //used with toggle to prevent continuous triggering when hand held in place
    int  _handRemovedConfirmDelay = 500;
    bool _handRemoved = true;  //starts assuming hand is removed
    bool _unconfirmedHandRemoval = false;
    long _lastConfirmedHandRemovalTime = 0;
    long _lastUnconfirmedHandRemovalTime = 0;
    
    // vars for smoothing
    int _raValues[SMOOTHING];
    int _raLen;
    int _raInc;
    int _raFinal;

    int _sensorValue = 0;
};

//------------------------------------------------------------------
TouchlessButton::TouchlessButton(int id, int pin, int behavior) {
  this->_buttonId = id;
  this->_analogPin = pin;
  this->_lastConfirmedTriggerTime = millis();
  this->_recoveryTime = 0;
  this->_raLen = SMOOTHING;
  this->_raInc = 0;

  this->setBehavior(behavior);
  
  // initialize all running average values to zero
  memset(_raValues, 0, sizeof(_raValues));
//  memset(radioGroup, 0, sizeof(radioGroup));
  delay(10);
}

//------------------------------------------------------------------

void TouchlessButton::setBehavior(int behavior) {
  // only one behavior per button
  this->_isTrigger    = false;
  this->_isToggle     = false;
  this->_isRadio      = false;
  this->_isCControl   = false;
  
 switch (behavior) {
  case 1: // momentary-trigger
    this->_isTrigger = true;
    break;
  case 2: // toggle
    this->_isToggle = true;
    break;
  case 3: // radio
    this->_isRadio = true;
    break;
  case 4: // continuous
    this->_isCControl = true;
    break;
  default: // no action
    break;
 }
}

//------------------------------------------------------------------

int TouchlessButton::getValue() {
  return this->_sensorValue;
}

//------------------------------------------------------------------
int TouchlessButton::calcRunningAverage() {
  // get sum of arr vals
  int arrSum = this->sumArray();
  int arrAvg = arrSum / this->_raLen;

  //  this->_raFinal = arrAvg;
  return arrAvg;
}

//------------------------------------------------------------------
int TouchlessButton::sumArray() {
  int arrSum  = 0;
  // sum all values
  for (int i = 0; i < this->_raLen; i++) {
    arrSum += this->_raValues[i];
    } 
  return arrSum;
  }

//------------------------------------------------------------------
void TouchlessButton::setThreshold(int minThreshold, int maxThreshold) {
  this->_minThreshold = minThreshold;
  this->_maxThreshold = maxThreshold;
}

//------------------------------------------------------------------
void TouchlessButton::update() {
  
  int  _min    = this->_minThreshold;
  int  _max    = this->_maxThreshold;
  int  _id     = this->_buttonId;
  int  _pin    = this->_analogPin;
  
   //5v
  float volts = analogRead(_pin)*0.0048828125;  // value from sensor * (5/1024)
  
  int dist = 13*pow(volts, -1); // worked out from datasheet graph

  this->_raValues[this->_raInc] = dist;

  this->_raFinal = this->calcRunningAverage();
  
  if(RANGE_TEST) {
    Serial.print("sensor:\t");
    Serial.print(_buttonId);
    
    Serial.print("\traw:\t");
    Serial.print(dist);
    
    Serial.print("\tsmooth:\t");
    Serial.print(this->_raFinal);
    
    Serial.print("\tmin:\t");
    Serial.print(this->_minThreshold);
    
    Serial.print("\tmax:\t");
    Serial.print(this->_maxThreshold);
    
    Serial.println();
  }
  
  // --------------------------------------------------
  // 1 - IF WITHIN RANGE

  //Serial.println(this->_raFinal);
  
  if (this->_raFinal >= _min && this->_raFinal <= _max ) {

    //acknowledge a trigger, but wait to confirm
    if(!this->_unconfirmedTrigger) {
      this->_unconfirmedTrigger = true;
      this->_lastUnconfirmedTriggerTime = millis();
    } 
    
    // proceed if we've had an confirmed trigger for the set duration
    else if (millis() - this->_lastUnconfirmedTriggerTime > this->_triggerConfirmDelay) {

      this->_sensorValue = this->_raFinal;

      // --------------------------------------------------
      // TRIGGER
      
      if(this->_isTrigger && this->_handRemoved)  // trigger button
      {
        if( millis() - this->_lastConfirmedTriggerTime > 
        this->_triggerConfirmDelay) { //don't retrigger too often

          this->_lastConfirmedTriggerTime = millis();
          Serial.println("Setting hand-removed: false");
          this->_handRemoved = false; // hand over sensor

          if(DEBUG_BTN) Serial.println("TOGGLE : ON-CLICK");
          
          onButtonTriggered(_id, this->_sensorValue);
        }
      } 
  
      // --------------------------------------------------
      // TOGGLE
      
      else if(this->_isToggle && this->_handRemoved) // toggle button
      {
        if( millis() - this->_lastConfirmedTriggerTime > 
        this->_triggerConfirmDelay) { //don't retrigger too often
          
          this->_lastConfirmedTriggerTime = millis(); //reset clock
          this->_handRemoved = false; // hand over sensor

          if(DEBUG_BTN) Serial.println("TRIGGER : ON-CLICK");
          
          this->_toggleOn = !this->_toggleOn;
          if(this->_toggleOn) {
            onButtonTriggered(_id, this->_sensorValue);
          } else {
            onButtonTriggered(_id, 0);//send zero for off
          }
        }
      }
  
      // --------------------------------------------------
      // RADIO
      
      else if(this->_isRadio && this->_handRemoved && _id != currRadioId) // radio button
      {        
        if( millis() - this->_lastConfirmedTriggerTime > 
        this->_triggerConfirmDelay) { //don't retrigger too often
          
          this->_lastConfirmedTriggerTime = millis(); // reset clock
          this->_handRemoved = false; // hand over sensor

          if(DEBUG_BTN) Serial.println("RADIO : ON-CLICK");

          for(int i = 0; i < NUM_RADIO; i++) {

            if(RADIO_GROUP[i] == _id) {
              currRadioId = _id;
              // turn on the selected radio button
              onButtonTriggered(RADIO_GROUP[i], this->_sensorValue);
            } else {
              //turn off other radio buttons in the group
              onButtonTriggered(RADIO_GROUP[i], 0);
            }
          }
        }
      } 
      
      // --------------------------------------------------
      else if(this->_isCControl) // continous controller
      {
        onButtonTriggered(_id, this->_sensorValue);
      }
      
    }
    
  // --------------------------------------------------
  // 1 - IF NOT WITHIN RANGE

  } else if(!_handRemoved) { // if holding hand over sensor

    //acknowledge a hand removal, but wait to confirm
    if(!this->_unconfirmedHandRemoval) {
      this->_unconfirmedHandRemoval = true;
      this->_lastConfirmedHandRemovalTime = millis();
    } 

    if(this->_unconfirmedHandRemoval && millis() - this->_lastConfirmedHandRemovalTime > 
       this->_handRemovedConfirmDelay) {

       this->_lastConfirmedHandRemovalTime = millis();
       this->_handRemoved = true;

       if(DEBUG_BTN) Serial.println("ON-UNCLICK");
     }
     
  } else { // after hand removal is confirmed, we can "untrigger"

    // Serial.println("untriggered");
    this->_unconfirmedTrigger = false;
    this->_sensorValue = 0;
  }

  // increment to fill arr w vals; loop back to 0 if over raLen
  this->_raInc++;
  this->_raInc = this->_raInc % this->_raLen;

  delay(_recoveryTime); // analog read recovery time
}
